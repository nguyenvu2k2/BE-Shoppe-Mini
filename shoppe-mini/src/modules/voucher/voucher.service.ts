import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VoucherType,
  type Voucher,
} from '../../../generated/prisma/client';
import { CreateVoucherDto } from '../../common/dto/voucher/create-voucher.dto';
import { PreviewVoucherDto } from '../../common/dto/voucher/preview-voucher.dto';
import { UpdateVoucherDto } from '../../common/dto/voucher/update-voucher.dto';
import { computeShippingFee } from '../../common/utils/shipping';
import { roundMoney } from '../../common/utils/unit-price';
import {
  computeDiscount,
  VOUCHER_MIN_ORDER_ERROR,
} from '../../common/utils/voucher';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart/cart.service';

export type QuotedVoucher = {
  voucherId: number;
  code: string;
  discountAmount: number;
};

export type ListVouchersQuery = {
  page?: number;
  limit?: number;
  isActive?: boolean;
  code?: string;
};

type VoucherDb = PrismaService | Prisma.TransactionClient;

@Injectable()
export class VoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
  ) {}

  normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  async create(dto: CreateVoucherDto) {
    const code = this.normalizeCode(dto.code);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    const maxDiscount = dto.maxDiscount ?? null;

    this.assertVoucherRules({
      type: dto.type,
      value: dto.value,
      maxDiscount,
      startsAt,
      endsAt,
    });

    try {
      const voucher = await this.prisma.voucher.create({
        data: {
          code,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          type: dto.type,
          value: new Prisma.Decimal(dto.value),
          minOrderAmount: new Prisma.Decimal(dto.minOrderAmount ?? 0),
          maxDiscount:
            maxDiscount == null ? null : new Prisma.Decimal(maxDiscount),
          usageLimit: dto.usageLimit ?? null,
          perUserLimit: dto.perUserLimit ?? 1,
          startsAt,
          endsAt,
          isActive: dto.isActive ?? true,
        },
      });
      return this.toAdminResponse(voucher);
    } catch (err) {
      this.rethrowCodeConflict(err);
      throw err;
    }
  }

  async update(id: number, dto: UpdateVoucherDto) {
    const existing = await this.findByIdOrThrow(id);

    const type = dto.type ?? existing.type;
    const value = dto.value ?? Number(existing.value);
    const maxDiscount =
      type === VoucherType.FIXED
        ? null
        : dto.maxDiscount !== undefined
          ? dto.maxDiscount
          : existing.maxDiscount == null
            ? null
            : Number(existing.maxDiscount);
    const startsAt =
      dto.startsAt !== undefined
        ? dto.startsAt
          ? new Date(dto.startsAt)
          : null
        : existing.startsAt;
    const endsAt =
      dto.endsAt !== undefined
        ? dto.endsAt
          ? new Date(dto.endsAt)
          : null
        : existing.endsAt;

    this.assertVoucherRules({ type, value, maxDiscount, startsAt, endsAt });

    try {
      const voucher = await this.prisma.voucher.update({
        where: { id },
        data: {
          ...(dto.code !== undefined && {
            code: this.normalizeCode(dto.code),
          }),
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.description !== undefined && {
            description: dto.description?.trim() || null,
          }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.value !== undefined && {
            value: new Prisma.Decimal(dto.value),
          }),
          ...(dto.minOrderAmount !== undefined && {
            minOrderAmount: new Prisma.Decimal(dto.minOrderAmount),
          }),
          maxDiscount:
            maxDiscount == null ? null : new Prisma.Decimal(maxDiscount),
          ...(dto.usageLimit !== undefined && {
            usageLimit: dto.usageLimit,
          }),
          ...(dto.perUserLimit !== undefined && {
            perUserLimit: dto.perUserLimit,
          }),
          ...(dto.startsAt !== undefined && { startsAt }),
          ...(dto.endsAt !== undefined && { endsAt }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
      return this.toAdminResponse(voucher);
    } catch (err) {
      this.rethrowCodeConflict(err);
      throw err;
    }
  }

  async remove(id: number) {
    const existing = await this.findByIdOrThrow(id);

    const usageCount = await this.prisma.voucherUsage.count({
      where: { voucherId: existing.id },
    });
    if (usageCount > 0) {
      throw new BadRequestException(
        'Cannot delete a voucher that has been used. Deactivate it instead.',
      );
    }

    await this.prisma.voucher.delete({ where: { id } });
    return { message: 'Voucher deleted successfully' };
  }

  async findManage(query: ListVouchersQuery = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const code = query.code ? this.normalizeCode(query.code) : undefined;

    const where: Prisma.VoucherWhereInput = {
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(code && { code: { contains: code, mode: 'insensitive' } }),
    };

    const [total, vouchers] = await this.prisma.$transaction([
      this.prisma.voucher.count({ where }),
      this.prisma.voucher.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      items: vouchers.map((v) => this.toAdminResponse(v)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(id: number) {
    const voucher = await this.findByIdOrThrow(id);
    return this.toAdminResponse(voucher);
  }

  async listActive() {
    const now = new Date();
    const vouchers = await this.prisma.voucher.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return vouchers
      .filter((v) => v.usageLimit == null || v.usedCount < v.usageLimit)
      .map((v) => this.toPublicResponse(v));
  }

  /** Preview: validate eligibility, do not lock or write usage. */
  async quote(
    userId: number,
    code: string,
    subtotal: number,
  ): Promise<QuotedVoucher> {
    const voucher = await this.findByCodeOrThrow(this.normalizeCode(code));
    const discountAmount = await this.assertRedeemable(
      voucher,
      userId,
      subtotal,
      this.prisma,
    );
    return {
      voucherId: voucher.id,
      code: voucher.code,
      discountAmount,
    };
  }

  /** Quote against the current cart. Does not consume a usage slot. */
  async preview(userId: number, dto: PreviewVoucherDto) {
    const cart = await this.cartService.getCart(userId);

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

    if (selected.some((item) => !item.isAvailable)) {
      throw new BadRequestException(
        'One or more cart items are no longer available',
      );
    }

    const subtotal = roundMoney(
      selected.reduce((sum, item) => sum + item.lineTotal, 0),
    );
    const shippingFee = computeShippingFee();
    const quoted = await this.quote(userId, dto.code, subtotal);

    return {
      ...quoted,
      subtotal,
      shippingFee,
      total: roundMoney(subtotal - quoted.discountAmount + shippingFee),
    };
  }

  /**
   * Checkout: lock the voucher row, re-check eligibility.
   * Caller must create Order + VoucherUsage after this returns.
   */
  async redeemInTx(
    tx: Prisma.TransactionClient,
    params: { userId: number; code: string; subtotal: number },
  ): Promise<QuotedVoucher> {
    const code = this.normalizeCode(params.code);
    const found = await tx.voucher.findUnique({ where: { code } });
    if (!found) {
      throw new BadRequestException('Voucher not found');
    }

    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM vouchers WHERE id = ${found.id} FOR UPDATE`,
    );

    const voucher = await tx.voucher.findUnique({ where: { id: found.id } });
    if (!voucher) {
      throw new BadRequestException('Voucher not found');
    }

    const discountAmount = await this.assertRedeemable(
      voucher,
      params.userId,
      params.subtotal,
      tx,
    );

    return {
      voucherId: voucher.id,
      code: voucher.code,
      discountAmount,
    };
  }

  private async findByIdOrThrow(id: number) {
    const voucher = await this.prisma.voucher.findUnique({ where: { id } });
    if (!voucher) {
      throw new NotFoundException('Voucher not found');
    }
    return voucher;
  }

  private async findByCodeOrThrow(code: string) {
    const voucher = await this.prisma.voucher.findUnique({ where: { code } });
    if (!voucher) {
      throw new BadRequestException('Voucher not found');
    }
    return voucher;
  }

  private async assertRedeemable(
    voucher: Voucher,
    userId: number,
    subtotal: number,
    db: VoucherDb,
  ): Promise<number> {
    const now = new Date();

    if (!voucher.isActive) {
      throw new BadRequestException('Voucher is not active');
    }
    if (voucher.startsAt && now < voucher.startsAt) {
      throw new BadRequestException('Voucher is not yet valid');
    }
    if (voucher.endsAt && now > voucher.endsAt) {
      throw new BadRequestException('Voucher has expired');
    }
    if (voucher.usageLimit != null && voucher.usedCount >= voucher.usageLimit) {
      throw new BadRequestException('Voucher usage limit reached');
    }

    const usedByUser = await db.voucherUsage.count({
      where: { voucherId: voucher.id, userId },
    });
    if (usedByUser >= voucher.perUserLimit) {
      throw new BadRequestException('You have already used this voucher');
    }

    try {
      return computeDiscount(subtotal, {
        type: voucher.type,
        value: Number(voucher.value),
        minOrderAmount: Number(voucher.minOrderAmount),
        maxDiscount:
          voucher.maxDiscount == null ? null : Number(voucher.maxDiscount),
      });
    } catch (err) {
      if (err instanceof Error && err.message === VOUCHER_MIN_ORDER_ERROR) {
        throw new BadRequestException(
          'Order does not meet voucher minimum',
        );
      }
      throw err;
    }
  }

  private assertVoucherRules(input: {
    type: VoucherType;
    value: number;
    maxDiscount: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
  }) {
    if (input.type === VoucherType.PERCENT && input.value > 100) {
      throw new BadRequestException('PERCENT value cannot exceed 100');
    }
    if (input.type === VoucherType.FIXED && input.maxDiscount != null) {
      throw new BadRequestException(
        'maxDiscount is only valid for PERCENT vouchers',
      );
    }
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
  }

  private rethrowCodeConflict(err: unknown): void {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException('Voucher code already exists');
    }
  }

  private toAdminResponse(voucher: Voucher) {
    return {
      ...this.toPublicResponse(voucher),
      usageLimit: voucher.usageLimit,
      usedCount: voucher.usedCount,
      perUserLimit: voucher.perUserLimit,
      isActive: voucher.isActive,
      createdAt: voucher.createdAt,
      updatedAt: voucher.updatedAt,
    };
  }

  private toPublicResponse(voucher: Voucher) {
    return {
      id: voucher.id,
      code: voucher.code,
      name: voucher.name,
      description: voucher.description,
      type: voucher.type,
      value: Number(voucher.value),
      minOrderAmount: Number(voucher.minOrderAmount),
      maxDiscount:
        voucher.maxDiscount == null ? null : Number(voucher.maxDiscount),
      startsAt: voucher.startsAt,
      endsAt: voucher.endsAt,
    };
  }
}
