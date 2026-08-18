import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentTxnStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePaymentStatusDto } from '../../common/dto/order/update-payment-status.dto';
import { ListPaymentsQueryDto } from '../../common/dto/payment/list-payments-query.dto';
import {
  buildVnpPaymentUrl,
  formatVnpDate,
  toVnpAmount,
  verifyVnpSecureHash,
} from '../../common/utils/vnpay.util';
import { restoreInventory } from '../order/restore-inventory';

type VnpIpnResponse = { RspCode: string; Message: string };

export type VnpReturnStatus = 'success' | 'pending' | 'failed';

export type VnpReturnResult = {
  valid: boolean;
  status: VnpReturnStatus;
  paid: boolean;
  orderId: number | null;
  orderCode: string | null;
  txnRef: string | null;
  responseCode: string | null;
  message: string;
  redirectUrl: string;
};

const PAY_URL_TTL_MS = 15 * 60 * 1000;
const EXPIRE_INTERVAL_MS = 60 * 1000;

@Injectable()
export class PaymentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentService.name);
  private expireTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.expireTimer = setInterval(() => {
      void this.expireStaleVnpayOrders().catch((err: unknown) => {
        this.logger.error(
          'Failed to expire stale VNPay orders',
          err instanceof Error ? err.stack : String(err),
        );
      });
    }, EXPIRE_INTERVAL_MS);
    void this.expireStaleVnpayOrders().catch((err: unknown) => {
      this.logger.error(
        'Failed to expire stale VNPay orders',
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  onModuleDestroy() {
    if (this.expireTimer) {
      clearInterval(this.expireTimer);
    }
  }

  /**
   * Tạo URL VNPay. Mỗi lần gọi = một txnRef mới (VNPay từ chối gửi lại cùng vnp_TxnRef).
   * PENDING cũ (nếu có) bị SUPERSEDED trong cùng transaction — unique 1 PENDING / đơn.
   */
  async createVnpayUrl(
    userId: number,
    orderId: number,
    ipAddr: string,
    opts?: { skipExpire?: boolean },
  ) {
    if (!opts?.skipExpire) {
      await this.expireStaleVnpayOrders();
    }

    const tmnCode = this.configService.getOrThrow<string>('VNP_TMN_CODE');
    const hashSecret = this.configService.getOrThrow<string>('VNP_HASH_SECRET');
    const payUrl = this.configService.getOrThrow<string>('VNP_URL');
    const returnUrl = this.configService.getOrThrow<string>('VNP_RETURN_URL');

    const now = new Date();
    const expireAt = new Date(now.getTime() + PAY_URL_TTL_MS);

    const prepared = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} AND user_id = ${userId} FOR UPDATE`,
      );

      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (order.paymentMethod !== PaymentMethod.VNPAY) {
        throw new BadRequestException('Order is not a VNPay order');
      }

      if (order.status !== OrderStatus.PENDING) {
        throw new BadRequestException(
          order.status === OrderStatus.CANCELLED
            ? 'Cannot pay a cancelled order'
            : 'Cannot pay this order',
        );
      }

      if (order.paymentStatus === PaymentStatus.PAID) {
        throw new BadRequestException('Order is already paid');
      }

      const amount = Number(order.total);

      const livePending = await tx.payment.findFirst({
        where: {
          orderId: order.id,
          method: PaymentMethod.VNPAY,
          status: PaymentTxnStatus.PENDING,
          txnRef: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
      });

      // Never reuse txnRef on a newly signed URL. VNPay Error.html?code=01
      // ("already processing / timed out") if the same vnp_TxnRef is submitted twice.
      if (livePending) {
        await tx.payment.update({
          where: { id: livePending.id },
          data: {
            status: PaymentTxnStatus.FAILED,
            responseCode: 'SUPERSEDED',
          },
        });
      }

      const txnRef = this.generateTxnRef(order.id);
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          method: PaymentMethod.VNPAY,
          status: PaymentTxnStatus.PENDING,
          amount,
          txnRef,
        },
      });

      return {
        orderId: order.id,
        orderCode: order.orderCode,
        paymentId: payment.id,
        txnRef,
        amount,
      };
    });

    const paymentUrl = buildVnpPaymentUrl(
      payUrl,
      {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: tmnCode,
        vnp_Locale: 'vn',
        vnp_CurrCode: 'VND',
        vnp_TxnRef: prepared.txnRef,
        vnp_OrderInfo: `Thanh toan don hang ${prepared.orderCode}`,
        vnp_OrderType: 'other',
        vnp_Amount: toVnpAmount(prepared.amount),
        vnp_ReturnUrl: returnUrl,
        vnp_IpAddr: ipAddr,
        vnp_CreateDate: formatVnpDate(now),
        vnp_ExpireDate: formatVnpDate(expireAt),
      },
      hashSecret,
    );

    return {
      paymentId: prepared.paymentId,
      orderId: prepared.orderId,
      orderCode: prepared.orderCode,
      txnRef: prepared.txnRef,
      amount: prepared.amount,
      expireAt,
      paymentUrl,
    };
  }

  /**
   * Hết hạn sau 15 phút: chỉ PENDING (hoặc đơn chưa có payment) mới giữ cửa sổ.
   * Dòng FAILED/EXPIRED không được coi là “còn sống” vì updateMany làm mới updatedAt.
   */
  async expireStaleVnpayOrders() {
    const cutoff = new Date(Date.now() - PAY_URL_TTL_MS);
    const liveAttempt: Prisma.PaymentWhereInput = {
      OR: [
        { status: PaymentTxnStatus.PAID },
        {
          status: PaymentTxnStatus.PENDING,
          updatedAt: { gte: cutoff },
        },
      ],
    };

    await this.prisma.payment.updateMany({
      where: {
        method: PaymentMethod.VNPAY,
        status: PaymentTxnStatus.PENDING,
        updatedAt: { lt: cutoff },
      },
      data: {
        status: PaymentTxnStatus.FAILED,
        responseCode: 'EXPIRED',
      },
    });

    const staleOrders = await this.prisma.order.findMany({
      where: {
        paymentMethod: PaymentMethod.VNPAY,
        status: OrderStatus.PENDING,
        paymentStatus: { not: PaymentStatus.PAID },
        createdAt: { lt: cutoff },
        payments: { none: liveAttempt },
      },
      select: { id: true },
    });

    for (const order of staleOrders) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`,
        );

        const paidOrLive = await tx.payment.findFirst({
          where: { orderId: order.id, ...liveAttempt },
        });
        if (paidOrLive) {
          return;
        }

        const cancelled = await tx.order.updateMany({
          where: {
            id: order.id,
            status: OrderStatus.PENDING,
            paymentStatus: { not: PaymentStatus.PAID },
          },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: 'VNPay payment expired',
            paymentStatus: PaymentStatus.FAILED,
          },
        });
        if (cancelled.count === 0) {
          return;
        }

        const items = await tx.orderItem.findMany({
          where: { orderId: order.id },
        });
        await restoreInventory(tx, items);

        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            method: PaymentMethod.VNPAY,
            status: PaymentTxnStatus.PENDING,
          },
          data: {
            status: PaymentTxnStatus.FAILED,
            responseCode: 'EXPIRED',
          },
        });
      });
    }
  }

  /** Khách: lịch sử thanh toán của một đơn thuộc về mình. */
  async findByOrderForUser(userId: number, orderId: number) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const payments = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((p) => this.toPaymentResponse(p));
  }

  /** Admin: list mọi lần thanh toán, lọc orderId / status / method. */
  async findManage(query: ListPaymentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {
      ...(query.orderId && { orderId: query.orderId }),
      ...(query.status && { status: query.status }),
      ...(query.method && { method: query.method }),
    };

    const [total, payments] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { id: true, orderCode: true, userId: true } },
        },
      }),
    ]);

    return {
      items: payments.map((p) => ({
        ...this.toPaymentResponse(p),
        order: p.order,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Admin xác nhận tay: chỉ COD / BANK_TRANSFER.
   * VNPay phải đi qua IPN. Mỗi lần xác nhận = một dòng ledger mới.
   */
  async confirmManual(orderId: number, dto: UpdatePaymentStatusDto) {
    const allowedFrom: Record<PaymentStatus, PaymentStatus[]> = {
      [PaymentStatus.PAID]: [PaymentStatus.UNPAID, PaymentStatus.FAILED],
      [PaymentStatus.FAILED]: [PaymentStatus.UNPAID],
      [PaymentStatus.REFUNDED]: [PaymentStatus.PAID],
      [PaymentStatus.UNPAID]: [],
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`,
      );

      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (order.paymentMethod === PaymentMethod.VNPAY) {
        throw new BadRequestException(
          'VNPay orders are confirmed via IPN, not manually',
        );
      }

      if (!allowedFrom[dto.paymentStatus].includes(order.paymentStatus)) {
        throw new BadRequestException(
          `Cannot change payment from ${order.paymentStatus} to ${dto.paymentStatus}`,
        );
      }

      if (
        order.status === OrderStatus.CANCELLED &&
        dto.paymentStatus !== PaymentStatus.REFUNDED
      ) {
        throw new BadRequestException('Cancelled orders only accept REFUNDED');
      }

      const txnStatus =
        dto.paymentStatus === PaymentStatus.PAID
          ? PaymentTxnStatus.PAID
          : dto.paymentStatus === PaymentStatus.FAILED
            ? PaymentTxnStatus.FAILED
            : PaymentTxnStatus.REFUNDED;

      const paidAt =
        dto.paymentStatus === PaymentStatus.PAID ? new Date() : null;

      await tx.payment.create({
        data: {
          orderId: order.id,
          method: order.paymentMethod,
          status: txnStatus,
          amount: order.total,
          paidAt,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: dto.paymentStatus,
          ...(dto.paymentStatus === PaymentStatus.PAID && { paidAt }),
        },
      });
    });

    return this.findByOrderId(orderId);
  }

  private async findByOrderId(orderId: number) {
    const payments = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return payments.map((p) => this.toPaymentResponse(p));
  }

  private toPaymentResponse(payment: {
    id: number;
    orderId: number;
    method: PaymentMethod;
    status: PaymentTxnStatus;
    amount: Prisma.Decimal;
    txnRef: string | null;
    transactionId: string | null;
    bankCode: string | null;
    responseCode: string | null;
    paidAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: payment.id,
      orderId: payment.orderId,
      method: payment.method,
      status: payment.status,
      amount: Number(payment.amount),
      txnRef: payment.txnRef,
      transactionId: payment.transactionId,
      bankCode: payment.bankCode,
      responseCode: payment.responseCode,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  /** PAY{orderId}-{yyyyMMddHHmmss}-{6 chars} — unique per attempt. */
  private generateTxnRef(orderId: number) {
    const stamp = formatVnpDate(new Date());
    const random = Array.from({ length: 6 }, () =>
      'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.charAt(
        Math.floor(Math.random() * 32),
      ),
    ).join('');

    return `PAY${orderId}-${stamp}-${random}`;
  }

  /**
   * VNPay IPN (server-to-server). Always HTTP 200 + RspCode JSON.
   * RspCode 00 = "we processed this notice", not "customer paid successfully".
   */
  async handleVnpayIpn(query: Record<string, string>): Promise<VnpIpnResponse> {
    try {
      return await this.processVnpayIpn(query);
    } catch {
      return { RspCode: '99', Message: 'Unknown error' };
    }
  }

  private async processVnpayIpn(
    query: Record<string, string>,
  ): Promise<VnpIpnResponse> {
    const hashSecret = this.configService.getOrThrow<string>('VNP_HASH_SECRET');
    if (!verifyVnpSecureHash(query, hashSecret)) {
      return { RspCode: '97', Message: 'Invalid signature' };
    }

    const txnRef = query.vnp_TxnRef;
    if (!txnRef) {
      return { RspCode: '01', Message: 'Order not found' };
    }

    const paidAtGateway =
      query.vnp_ResponseCode === '00' &&
      (query.vnp_TransactionStatus == null ||
        query.vnp_TransactionStatus === '00');

    const rawPayload = query as Prisma.InputJsonValue;

    return this.prisma.$transaction(async (tx) => {
      const found = await tx.payment.findUnique({
        where: { txnRef },
      });

      if (!found) {
        return { RspCode: '01', Message: 'Order not found' };
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM orders WHERE id = ${found.orderId} FOR UPDATE`,
      );

      const payment = await tx.payment.findUnique({
        where: { id: found.id },
        include: { order: true },
      });

      if (!payment) {
        return { RspCode: '01', Message: 'Order not found' };
      }

      if (payment.status === PaymentTxnStatus.PAID) {
        return { RspCode: '02', Message: 'Order already confirmed' };
      }

      const expectedAmount = toVnpAmount(Number(payment.amount));
      const receivedAmount = Number(query.vnp_Amount);
      if (receivedAmount !== expectedAmount) {
        return { RspCode: '04', Message: 'Invalid amount' };
      }

      const gatewayFields = {
        transactionId: query.vnp_TransactionNo || null,
        bankCode: query.vnp_BankCode || null,
        responseCode: query.vnp_ResponseCode || null,
        rawPayload,
      };

      if (!paidAtGateway) {
        await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: { not: PaymentTxnStatus.PAID },
          },
          data: {
            status: PaymentTxnStatus.FAILED,
            ...gatewayFields,
          },
        });

        return { RspCode: '00', Message: 'Confirm Success' };
      }

      // Gateway charged. Record PAID on this row even if the order was cancelled
      // (admin must refund). Do not reopen a cancelled order.
      const locked = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: { not: PaymentTxnStatus.PAID },
        },
        data: {
          status: PaymentTxnStatus.PAID,
          ...gatewayFields,
          responseCode: query.vnp_ResponseCode || '00',
          paidAt: new Date(),
        },
      });

      if (locked.count === 0) {
        return { RspCode: '02', Message: 'Order already confirmed' };
      }

      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
      });

      if (!order || order.status === OrderStatus.CANCELLED) {
        this.logger.warn(
          `VNPay IPN paid cancelled order ${payment.orderId} txnRef=${txnRef} — refund required`,
        );
        return { RspCode: '00', Message: 'Confirm Success' };
      }

      await tx.order.updateMany({
        where: {
          id: payment.orderId,
          status: { not: OrderStatus.CANCELLED },
          paymentStatus: { not: PaymentStatus.PAID },
        },
        data: {
          paymentStatus: PaymentStatus.PAID,
          paymentMethod: PaymentMethod.VNPAY,
          paidAt: new Date(),
        },
      });

      return { RspCode: '00', Message: 'Confirm Success' };
    });
  }

  /**
   * Local/sandbox: VNPay IPN cannot reach localhost, so the return URL applies
   * the same verified payload. Production stays IPN-only unless
   * VNP_CONFIRM_ON_RETURN=true.
   */
  private confirmOnReturnEnabled() {
    const flag = this.configService.get<string>('VNP_CONFIRM_ON_RETURN');
    if (flag === 'true') return true;
    if (flag === 'false') return false;
    return this.configService.get<string>('NODE_ENV') !== 'production';
  }

  /**
   * Browser return from VNPay. Verify checksum, then read DB.
   * Production: do not mark PAID here (IPN is source of truth).
   * Non-production: apply the return payload so local tests do not hang on pending.
   */
  async handleVnpayReturn(query: Record<string, string>): Promise<VnpReturnResult> {
    const hashSecret = this.configService.getOrThrow<string>('VNP_HASH_SECRET');
    const frontendUrl = this.configService
      .getOrThrow<string>('FRONTEND_URL')
      .replace(/\/$/, '');

    const txnRef = query.vnp_TxnRef ?? null;
    const responseCode = query.vnp_ResponseCode ?? null;

    const redirect = (
      status: VnpReturnStatus,
      extra: Partial<VnpReturnResult>,
    ): VnpReturnResult => {
      const result: VnpReturnResult = {
        valid: extra.valid ?? false,
        status,
        paid: extra.paid ?? false,
        orderId: extra.orderId ?? null,
        orderCode: extra.orderCode ?? null,
        txnRef: extra.txnRef ?? txnRef,
        responseCode: extra.responseCode ?? responseCode,
        message: extra.message ?? '',
        redirectUrl: '',
      };
      const qs = new URLSearchParams({
        status,
        ...(result.orderId != null && { orderId: String(result.orderId) }),
        ...(result.orderCode && { orderCode: result.orderCode }),
        ...(result.txnRef && { txnRef: result.txnRef }),
      });
      result.redirectUrl = `${frontendUrl}/payments/vnpay/return?${qs.toString()}`;
      return result;
    };

    if (!verifyVnpSecureHash(query, hashSecret)) {
      return redirect('failed', {
        valid: false,
        message: 'Invalid signature',
      });
    }

    if (!txnRef) {
      return redirect('failed', {
        valid: true,
        message: 'Missing txnRef',
      });
    }

    const payment = await this.prisma.payment.findUnique({
      where: { txnRef },
      include: {
        order: { select: { id: true, orderCode: true, status: true } },
      },
    });

    if (!payment) {
      return redirect('failed', {
        valid: true,
        message: 'Payment not found',
      });
    }

    if (
      this.confirmOnReturnEnabled() &&
      payment.status === PaymentTxnStatus.PENDING
    ) {
      try {
        await this.processVnpayIpn(query);
      } catch (err: unknown) {
        this.logger.error(
          `Return-URL confirm failed for txnRef=${txnRef}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
      const refreshed = await this.prisma.payment.findUnique({
        where: { txnRef },
        include: {
          order: { select: { id: true, orderCode: true, status: true } },
        },
      });
      if (refreshed) {
        payment.status = refreshed.status;
        payment.order = refreshed.order;
      }
    }

    const base = {
      valid: true,
      orderId: payment.order.id,
      orderCode: payment.order.orderCode,
      txnRef,
      responseCode,
    };

    if (payment.order.status === OrderStatus.CANCELLED) {
      return redirect('failed', {
        ...base,
        message:
          payment.status === PaymentTxnStatus.PAID
            ? 'Order was cancelled after a gateway charge; contact support for a refund'
            : 'Order was cancelled',
      });
    }

    if (payment.status === PaymentTxnStatus.PAID) {
      return redirect('success', {
        ...base,
        paid: true,
        message: 'Payment confirmed',
      });
    }

    if (payment.status === PaymentTxnStatus.FAILED) {
      return redirect('failed', {
        ...base,
        message: 'Payment failed',
      });
    }

    // PENDING: IPN may not have arrived yet. Do not trust return code to mark PAID.
    if (responseCode === '00') {
      return redirect('pending', {
        ...base,
        message: 'Waiting for IPN confirmation',
      });
    }

    return redirect('failed', {
      ...base,
      message: 'Payment was cancelled or declined',
    });
  }
}
