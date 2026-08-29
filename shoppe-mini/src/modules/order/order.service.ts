import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentTxnStatus,
  Prisma,
  ProductStatus,
} from '../../../generated/prisma/client';
import { CancelOrderDto } from '../../common/dto/order/cancel-order.dto';
import { CreateOrderDto } from '../../common/dto/order/create-order.dto';
import { ListMyOrdersQueryDto } from '../../common/dto/order/list-my-orders-query.dto';
import { ListOrdersQueryDto } from '../../common/dto/order/list-orders-query.dto';
import { UpdateOrderStatusDto } from '../../common/dto/order/update-order-status.dto';
import { UpdatePaymentStatusDto } from '../../common/dto/order/update-payment-status.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { computeShippingFee } from '../../common/utils/shipping';
import { roundMoney, unitPriceForLine } from '../../common/utils/unit-price';
import { PaymentService } from '../payment/payment.service';
import {
  InventoryRestoreError,
  adjustSoldCount,
  restoreInventory,
} from './restore-inventory';

const orderInclude = {
  items: { orderBy: { id: 'asc' as const } },
  user: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** status hiện tại → các status kế tiếp hợp lệ */
const STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPING]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.RETURNED]: [],
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
  ) {}

  // ==================== CUSTOMER ====================

  /**
   * Checkout toàn bộ giỏ hàng:
   * validate address của user → validate từng item (ACTIVE + đủ stock)
   * → transaction: trừ kho, tạo order + snapshot items, xóa cart items.
   * VNPAY: tạo Payment PENDING + paymentUrl. Nếu gen URL lỗi, vẫn trả order
   * (vnpay: null, vnpayError) để FE gọi POST /payments/vnpay/create.
   */
  async checkout(userId: number, dto: CreateOrderDto, ipAddr: string) {
    await this.paymentService.expireStaleOrders();

    const address = await this.prisma.address.findFirst({
      where: { id: dto.addressId, userId },
    });
    if (!address) {
      throw new BadRequestException('Address not found');
    }

    const order = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM carts WHERE user_id = ${userId} FOR UPDATE`,
      );

      const cart = await tx.cart.findUnique({
        where: { userId },
        include: {
          items: {
            orderBy: { createdAt: 'asc' },
            include: {
              product: { include: { inventory: true } },
              variant: { include: { inventory: true } },
            },
          },
        },
      });

      if (!cart || cart.items.length === 0) {
        throw new BadRequestException('Cart is empty');
      }

      let selected = cart.items;
      if (dto.itemIds?.length) {
        const wanted = new Set(dto.itemIds);
        selected = cart.items.filter((item) => wanted.has(item.id));
        if (selected.length !== wanted.size) {
          throw new BadRequestException(
            'One or more cart items were not found in your cart',
          );
        }
      }

      if (selected.length === 0) {
        throw new BadRequestException('Cart is empty');
      }

      const lines = selected.map((item) => {
        const product = item.product;

        if (product.deletedAt != null || product.status !== ProductStatus.ACTIVE) {
          throw new BadRequestException(
            `Product "${product.name}" is no longer available`,
          );
        }

        if (item.variantId != null) {
          if (!item.variant) {
            throw new BadRequestException(
              `Variant of product "${product.name}" no longer exists`,
            );
          }

          const stock = item.variant.inventory?.quantity ?? 0;
          if (item.quantity > stock) {
            throw new BadRequestException(
              `Only ${stock} item(s) of "${product.name} - ${item.variant.name}" left in stock`,
            );
          }

          return {
            inventoryId: item.variant.inventory!.id,
            productId: product.id,
            variantId: item.variantId,
            productName: product.name,
            variantName: item.variant.name,
            sku: item.variant.sku,
            thumbnail: product.thumbnail,
            unitPrice: unitPriceForLine(product, item.variant),
            quantity: item.quantity,
          };
        }

        const inventoryRow = product.inventory.find(
          (row) => row.variantId == null,
        );
        const stock = inventoryRow?.quantity ?? 0;
        if (item.quantity > stock) {
          throw new BadRequestException(
            `Only ${stock} item(s) of "${product.name}" left in stock`,
          );
        }

        return {
          inventoryId: inventoryRow!.id,
          productId: product.id,
          variantId: null,
          productName: product.name,
          variantName: null,
          sku: null,
          thumbnail: product.thumbnail,
          unitPrice: unitPriceForLine(product),
          quantity: item.quantity,
        };
      });

      const subtotal = roundMoney(
        lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
      );
      const shippingFee = computeShippingFee();
      const total = roundMoney(subtotal + shippingFee);

      if (dto.paymentMethod === PaymentMethod.VNPAY && total <= 0) {
        throw new BadRequestException('VNPay requires a total greater than 0');
      }

      for (const line of lines) {
        const updated = await tx.inventory.updateMany({
          where: { id: line.inventoryId, quantity: { gte: line.quantity } },
          data: { quantity: { decrement: line.quantity } },
        });

        if (updated.count === 0) {
          throw new BadRequestException(
            `"${line.productName}" is out of stock`,
          );
        }
      }

      const created = await tx.order.create({
        data: {
          orderCode: this.generateOrderCode(),
          userId,
          addressId: address.id,
          receiverName: address.fullName,
          receiverPhone: address.phone,
          addressLine: address.addressLine,
          ward: address.ward,
          district: address.district,
          province: address.province,
          paymentMethod: dto.paymentMethod,
          note: dto.note?.trim() || null,
          subtotal: new Prisma.Decimal(subtotal),
          shippingFee: new Prisma.Decimal(shippingFee),
          total: new Prisma.Decimal(total),
          items: {
            createMany: {
              data: lines.map((l) => ({
                productId: l.productId,
                variantId: l.variantId,
                productName: l.productName,
                variantName: l.variantName,
                sku: l.sku,
                thumbnail: l.thumbnail,
                unitPrice: new Prisma.Decimal(l.unitPrice),
                quantity: l.quantity,
              })),
            },
          },
        },
        include: orderInclude,
      });

      await tx.cartItem.deleteMany({
        where: {
          cartId: cart.id,
          id: { in: selected.map((item) => item.id) },
        },
      });

      return created;
    });

    const detail = this.toDetailResponse(order);

    if (dto.paymentMethod !== PaymentMethod.VNPAY) {
      return { ...detail, vnpay: null };
    }

    try {
      const vnpay = await this.paymentService.createVnpayUrl(
        userId,
        order.id,
        ipAddr,
        { skipExpire: true },
      );

      return {
        ...detail,
        vnpay: {
          paymentId: vnpay.paymentId,
          txnRef: vnpay.txnRef,
          expireAt: vnpay.expireAt,
          paymentUrl: vnpay.paymentUrl,
        },
      };
    } catch (err: unknown) {
      const vnpayError =
        err instanceof HttpException
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to create VNPay payment URL';
      this.logger.error(
        `VNPay URL failed for order ${order.id}: ${vnpayError}`,
      );
      return { ...detail, vnpay: null, vnpayError };
    }
  }

  /** Danh sách đơn của user, phân trang + lọc theo status. */
  async findMine(userId: number, query: ListMyOrdersQueryDto) {
    return this.findMany({
      page: query.page,
      limit: query.limit,
      where: {
        userId,
        ...(query.status && { status: query.status }),
      },
    });
  }

  /** Chi tiết một đơn, chỉ khi đơn thuộc về user. */
  async findOneForUser(userId: number, orderId: number) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.toDetailResponse(order);
  }

  /** User tự hủy đơn: chỉ khi còn PENDING và chưa PAID. */
  async cancelByUser(userId: number, orderId: number, dto: CancelOrderDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.cancelOrder(order, dto.cancelReason, [OrderStatus.PENDING], {
      allowPaid: false,
    });
  }

  // ==================== ADMIN ====================

  /** Admin: list mọi đơn, lọc status / paymentStatus / userId / orderCode. */
  async findManage(query: ListOrdersQueryDto) {
    return this.findMany({
      page: query.page,
      limit: query.limit,
      where: {
        ...(query.status && { status: query.status }),
        ...(query.paymentStatus && { paymentStatus: query.paymentStatus }),
        ...(query.userId && { userId: query.userId }),
        ...(query.orderCode?.trim() && {
          orderCode: { contains: query.orderCode.trim(), mode: 'insensitive' },
        }),
      },
    });
  }

  /** Admin: chi tiết đơn bất kỳ, không lọc theo userId. */
  async findOneForAdmin(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.toDetailResponse(order);
  }

  /**
   * Admin đẩy fulfillment theo đúng flow
   * PENDING → CONFIRMED → SHIPPING → COMPLETED, kèm timestamp tương ứng.
   */
  async updateStatus(orderId: number, dto: UpdateOrderStatusDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`,
      );

      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) {
        throw new NotFoundException('Order not found');
      }

      this.assertTransition(order.status, dto.status);

      const isFulfillment =
        dto.status === OrderStatus.CONFIRMED ||
        dto.status === OrderStatus.SHIPPING ||
        dto.status === OrderStatus.COMPLETED;

      if (
        isFulfillment &&
        order.paymentMethod === PaymentMethod.VNPAY &&
        order.paymentStatus !== PaymentStatus.PAID
      ) {
        throw new BadRequestException(
          'VNPay order must be paid before fulfillment',
        );
      }

      const updated = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: {
          status: dto.status,
          ...(dto.status === OrderStatus.SHIPPING && { shippedAt: new Date() }),
          ...(dto.status === OrderStatus.COMPLETED && {
            completedAt: new Date(),
          }),
        },
      });

      if (updated.count === 0) {
        throw new BadRequestException('Order could not be updated');
      }

      if (dto.status === OrderStatus.COMPLETED) {
        const items = await tx.orderItem.findMany({
          where: { orderId },
          select: { productId: true, quantity: true },
        });
        await adjustSoldCount(tx, items, 'increment');
      }
    });

    return this.findOneForAdmin(orderId);
  }

  /**
   * Admin cập nhật thanh toán COD/CK. VNPay không cho sửa tay (phải qua IPN).
   */
  async updatePaymentStatus(orderId: number, dto: UpdatePaymentStatusDto) {
    await this.paymentService.confirmManual(orderId, dto);
    return this.findOneForAdmin(orderId);
  }

  /** Admin hủy đơn: PENDING / CONFIRMED / SHIPPING. Đơn đã PAID thì gắn needsRefund. */
  async cancelByAdmin(orderId: number, dto: CancelOrderDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.cancelOrder(order, dto.cancelReason, [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPING,
    ], { allowPaid: true });
  }

  // ==================== PRIVATE ====================

  /**
   * Hủy đơn + hoàn kho. Khóa dòng order trước.
   * Unpaid: paymentStatus → FAILED.
   * Paid (admin only): giữ PAID, gắn needsRefund trên các payment PAID (hoàn tại cổng).
   */
  private async cancelOrder(
    order: Prisma.OrderGetPayload<{ include: { items: true } }>,
    cancelReason: string | undefined,
    allowedStatuses: OrderStatus[],
    opts: { allowPaid: boolean },
  ) {
    if (order.paymentStatus === PaymentStatus.PAID && !opts.allowPaid) {
      throw new BadRequestException(
        'Paid orders cannot be cancelled. Request a refund instead.',
      );
    }

    if (!allowedStatuses.includes(order.status)) {
      throw new BadRequestException(
        allowedStatuses.length === 1 &&
          allowedStatuses[0] === OrderStatus.PENDING
          ? 'Only pending orders can be cancelled. Please contact support.'
          : `Cannot cancel an order in ${order.status} status`,
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`,
        );

        const current = await tx.order.findUnique({ where: { id: order.id } });
        if (!current) {
          throw new NotFoundException('Order not found');
        }

        if (!allowedStatuses.includes(current.status)) {
          throw new BadRequestException(
            `Cannot cancel an order in ${current.status} status`,
          );
        }

        const isPaid = current.paymentStatus === PaymentStatus.PAID;
        if (isPaid && !opts.allowPaid) {
          throw new BadRequestException(
            'Paid orders cannot be cancelled. Request a refund instead.',
          );
        }

        const cancelled = await tx.order.updateMany({
          where: {
            id: order.id,
            status: { in: allowedStatuses },
            ...(isPaid
              ? { paymentStatus: PaymentStatus.PAID }
              : { paymentStatus: { not: PaymentStatus.PAID } }),
          },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: cancelReason?.trim() || null,
            ...(!isPaid && { paymentStatus: PaymentStatus.FAILED }),
          },
        });

        if (cancelled.count === 0) {
          throw new BadRequestException('Order could not be cancelled');
        }

        await restoreInventory(tx, order.items);

        if (isPaid) {
          await tx.payment.updateMany({
            where: {
              orderId: order.id,
              status: PaymentTxnStatus.PAID,
            },
            data: { needsRefund: true },
          });
        }

        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            status: PaymentTxnStatus.PENDING,
          },
          data: {
            status: PaymentTxnStatus.FAILED,
            responseCode: 'ORDER_CANCELLED',
          },
        });
      });
    } catch (err) {
      if (err instanceof InventoryRestoreError) {
        throw new InternalServerErrorException(
          'Could not restore inventory for this order. Contact support.',
        );
      }
      throw err;
    }

    return this.findOneForAdmin(order.id);
  }

  private async findMany(opts: {
    page?: number;
    limit?: number;
    where: Prisma.OrderWhereInput;
  }) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where: opts.where }),
      this.prisma.order.findMany({
        where: opts.where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: orderInclude,
      }),
    ]);

    return {
      items: orders.map((o) => this.toDetailResponse(o)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  private assertTransition(current: OrderStatus, next: OrderStatus) {
    if (!STATUS_FLOW[current].includes(next)) {
      throw new BadRequestException(
        `Cannot change order status from ${current} to ${next}`,
      );
    }
  }

  /** ORD-YYYYMMDD-XXXXXX, va chạm cực hiếm và đã có @unique chặn ở DB. */
  private generateOrderCode() {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');

    const random = Array.from({ length: 6 }, () =>
      'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.charAt(
        Math.floor(Math.random() * 32),
      ),
    ).join('');

    return `ORD-${date}-${random}`;
  }

  private toDetailResponse(order: OrderWithItems) {
    return {
      id: order.id,
      orderCode: order.orderCode,
      user: order.user,
      receiver: {
        name: order.receiverName,
        phone: order.receiverPhone,
        addressLine: order.addressLine,
        ward: order.ward,
        district: order.district,
        province: order.province,
      },
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      subtotal: Number(order.subtotal),
      shippingFee: Number(order.shippingFee),
      total: Number(order.total),
      note: order.note,
      cancelReason: order.cancelReason,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        productName: item.productName,
        variantName: item.variantName,
        sku: item.sku,
        thumbnail: item.thumbnail,
        unitPrice: Number(item.unitPrice),
        quantity: item.quantity,
        lineTotal: roundMoney(Number(item.unitPrice) * item.quantity),
      })),
      paidAt: order.paidAt,
      shippedAt: order.shippedAt,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
