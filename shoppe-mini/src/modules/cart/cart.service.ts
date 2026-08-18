import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '../../../generated/prisma/client';
import {
  AddCartItemDto,
  UpdateCartItemDto,
} from '../../common/dto/cart/cart-item.dto';
import { PrismaService } from '../../prisma/prisma.service';

const cartInclude = {
  items: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      product: {
        include: {
          inventory: true,
          variants: { include: { inventory: true } },
        },
      },
      variant: {
        include: { inventory: true },
      },
    },
  },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(userId: number) {
    const cart = await this.getOrCreateCart(userId);
    return this.toResponse(cart);
  }

  async addItem(userId: number, dto: AddCartItemDto) {
    const { product, variantId, availableStock } = await this.resolvePurchasable(
      dto.productId,
      dto.variantId,
    );

    if (dto.quantity > availableStock) {
      throw new BadRequestException(
        `Only ${availableStock} item(s) available in stock`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO carts (user_id, created_at, updated_at)
          VALUES (${userId}, NOW(), NOW())
          ON CONFLICT (user_id) DO NOTHING
        `,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM carts WHERE user_id = ${userId} FOR UPDATE`,
      );

      const cart = await tx.cart.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });

      const existing = await tx.cartItem.findFirst({
        where: {
          cartId: cart.id,
          productId: product.id,
          variantId,
        },
      });

      if (existing) {
        const nextQty = existing.quantity + dto.quantity;
        if (nextQty > availableStock) {
          throw new BadRequestException(
            `Only ${availableStock} item(s) available in stock (already ${existing.quantity} in cart)`,
          );
        }

        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: nextQty },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            productId: product.id,
            variantId,
            quantity: dto.quantity,
          },
        });
      }
    });

    return this.getCart(userId);
  }

  async updateItem(userId: number, itemId: number, dto: UpdateCartItemDto) {
    const cart = await this.getOrCreateCart(userId);
    const item = await this.findOwnedItem(cart.id, itemId);

    const { availableStock } = await this.resolvePurchasable(
      item.productId,
      item.variantId ?? undefined,
    );

    if (dto.quantity > availableStock) {
      throw new BadRequestException(
        `Only ${availableStock} item(s) available in stock`,
      );
    }

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity },
    });

    return this.getCart(userId);
  }

  async removeItem(userId: number, itemId: number) {
    const cart = await this.getOrCreateCart(userId);
    await this.findOwnedItem(cart.id, itemId);

    await this.prisma.cartItem.delete({ where: { id: itemId } });

    return this.getCart(userId);
  }

  async clear(userId: number) {
    const cart = await this.getOrCreateCart(userId);

    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

    return this.getCart(userId);
  }

  private async getOrCreateCart(userId: number): Promise<CartWithItems> {
    const existing = await this.prisma.cart.findUnique({
      where: { userId },
      include: cartInclude,
    });

    if (existing) {
      return existing;
    }

    return this.prisma.cart.create({
      data: { userId },
      include: cartInclude,
    });
  }

  private async findOwnedItem(cartId: number, itemId: number) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    return item;
  }

  private async resolvePurchasable(productId: number, variantId?: number) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        deletedAt: null,
        status: ProductStatus.ACTIVE,
      },
      include: {
        inventory: true,
        variants: { include: { inventory: true } },
      },
    });

    if (!product) {
      throw new BadRequestException('Product is not available');
    }

    const hasVariants = product.variants.length > 0;

    if (hasVariants) {
      if (variantId == null) {
        throw new BadRequestException(
          'variantId is required for this product',
        );
      }

      const variant = product.variants.find((v) => v.id === variantId);
      if (!variant) {
        throw new BadRequestException('Variant does not belong to this product');
      }

      const availableStock = variant.inventory?.quantity ?? 0;
      if (availableStock <= 0) {
        throw new BadRequestException('This variant is out of stock');
      }

      return {
        product,
        variantId: variant.id,
        unitPrice: Number(variant.price),
        availableStock,
      };
    }

    if (variantId != null) {
      throw new BadRequestException(
        'This product has no variants; omit variantId',
      );
    }

    const availableStock =
      product.inventory.find((row) => row.variantId == null)?.quantity ?? 0;

    if (availableStock <= 0) {
      throw new BadRequestException('This product is out of stock');
    }

    const unitPrice =
      product.discountPrice != null
        ? Number(product.discountPrice)
        : Number(product.price);

    return {
      product,
      variantId: null as number | null,
      unitPrice,
      availableStock,
    };
  }

  private toResponse(cart: CartWithItems) {
    const items = cart.items.map((item) => {
      const product = item.product;
      const isActive =
        product.deletedAt == null && product.status === ProductStatus.ACTIVE;

      let unitPrice = 0;
      let availableStock = 0;
      let variantPayload: {
        id: number;
        name: string;
        sku: string;
      } | null = null;

      if (item.variantId != null) {
        const variant =
          item.variant ??
          product.variants.find((v) => v.id === item.variantId) ??
          null;

        if (variant) {
          variantPayload = {
            id: variant.id,
            name: variant.name,
            sku: variant.sku,
          };
          unitPrice = Number(variant.price);
          availableStock = variant.inventory?.quantity ?? 0;
        }
      } else {
        unitPrice =
          product.discountPrice != null
            ? Number(product.discountPrice)
            : Number(product.price);
        availableStock =
          product.inventory.find((row) => row.variantId == null)?.quantity ?? 0;
      }

      const isAvailable =
        isActive && availableStock > 0 && item.quantity <= availableStock;
      const lineTotal = Number((unitPrice * item.quantity).toFixed(2));

      return {
        id: item.id,
        productId: product.id,
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          thumbnail: product.thumbnail,
          status: product.status,
        },
        variant: variantPayload,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
        availableStock,
        isAvailable,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    const selectable = items.filter((i) => i.isAvailable);
    const subtotal = Number(
      selectable.reduce((sum, i) => sum + i.lineTotal, 0).toFixed(2),
    );

    return {
      id: cart.id,
      items,
      summary: {
        itemCount: items.length,
        totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
        availableItemCount: selectable.length,
        subtotal,
      },
      updatedAt: cart.updatedAt,
    };
  }
}
