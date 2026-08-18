import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '../../../generated/prisma/client';
import { CreateProductDto } from '../../common/dto/product/create-product.dto';
import { ListProductsQueryDto } from '../../common/dto/product/list-products-query.dto';
import { UpdateProductDto } from '../../common/dto/product/update-product.dto';
import {
  CreateVariantDto,
  UpdateInventoryDto,
  UpdateVariantDto,
} from '../../common/dto/product/variant-inventory.dto';
import { slugify } from '../../common/utils/slugify';
import { PrismaService } from '../../prisma/prisma.service';
import { FileService } from '../files/file.service';
import { S3_FOLDERS } from '../files/s3.constants';

const productDetailInclude = {
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: {
    orderBy: { id: 'asc' as const },
    include: { inventory: true },
  },
  inventory: true,
} satisfies Prisma.ProductInclude;

type ProductDetail = Prisma.ProductGetPayload<{
  include: typeof productDetailInclude;
}>;

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {}

  async findPublic(query: ListProductsQueryDto) {
    return this.findMany({ ...query, status: ProductStatus.ACTIVE });
  }

  async findManage(query: ListProductsQueryDto) {
    return this.findMany(query);
  }

  async findOne(idOrSlug: string, opts?: { publicOnly?: boolean }) {
    const product = await this.findActiveByIdOrSlug(idOrSlug);

    if (opts?.publicOnly && product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException('Product not found');
    }

    return this.toDetailResponse(product);
  }

  async create(dto: CreateProductDto) {
    await this.assertCategoryExists(dto.categoryId);
    this.assertPrices(dto.price, dto.discountPrice);

    const slug = await this.resolveUniqueSlug(dto.slug ?? slugify(dto.name));
    if (!slug) {
      throw new BadRequestException('Could not generate a valid slug from name');
    }

    const hasVariants = (dto.variants?.length ?? 0) > 0;

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          categoryId: dto.categoryId,
          name: dto.name.trim(),
          slug,
          description: dto.description?.trim() || null,
          price: new Prisma.Decimal(dto.price),
          discountPrice:
            dto.discountPrice != null
              ? new Prisma.Decimal(dto.discountPrice)
              : null,
          status: dto.status ?? ProductStatus.DRAFT,
        },
      });

      if (hasVariants) {
        for (const variant of dto.variants!) {
          const createdVariant = await tx.productVariant.create({
            data: {
              productId: created.id,
              name: variant.name.trim(),
              sku: variant.sku.trim(),
              price: new Prisma.Decimal(variant.price),
            },
          });

          await tx.inventory.create({
            data: {
              productId: created.id,
              variantId: createdVariant.id,
              quantity: variant.quantity,
              warehouse: variant.warehouse?.trim() || null,
            },
          });
        }
      } else {
        await tx.inventory.create({
          data: {
            productId: created.id,
            variantId: null,
            quantity: dto.quantity ?? 0,
            warehouse: dto.warehouse?.trim() || null,
          },
        });
      }

      return tx.product.findUniqueOrThrow({
        where: { id: created.id },
        include: productDetailInclude,
      });
    });

    return this.toDetailResponse(product);
  }

  async update(id: number, dto: UpdateProductDto) {
    await this.findActiveById(id);

    if (dto.categoryId != null) {
      await this.assertCategoryExists(dto.categoryId);
    }

    const current = await this.prisma.product.findUniqueOrThrow({
      where: { id },
    });

    const nextPrice =
      dto.price != null ? dto.price : Number(current.price);
    const nextDiscount =
      dto.discountPrice === undefined
        ? current.discountPrice != null
          ? Number(current.discountPrice)
          : undefined
        : dto.discountPrice === null
          ? undefined
          : dto.discountPrice;

    this.assertPrices(nextPrice, nextDiscount);

    let nextSlug: string | undefined;
    if (dto.slug !== undefined) {
      nextSlug = await this.resolveUniqueSlug(dto.slug, id);
    }

    await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(nextSlug !== undefined && { slug: nextSlug }),
        ...(dto.description !== undefined && {
          description: dto.description.trim() || null,
        }),
        ...(dto.price !== undefined && {
          price: new Prisma.Decimal(dto.price),
        }),
        ...(dto.discountPrice !== undefined && {
          discountPrice:
            dto.discountPrice === null
              ? null
              : new Prisma.Decimal(dto.discountPrice),
        }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    return this.findOne(String(id));
  }

  async remove(id: number) {
    await this.findActiveById(id);

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: ProductStatus.INACTIVE },
    });

    return { message: 'Product deleted successfully' };
  }

  async updateThumbnail(id: number, file: Express.Multer.File) {
    const existing = await this.findActiveById(id);
    const oldKey = existing.thumbnail
      ? this.fileService.extractKeyFromUrl(existing.thumbnail)
      : null;

    const uploaded = await this.fileService.upload(file, S3_FOLDERS.PRODUCTS);

    await this.prisma.product.update({
      where: { id },
      data: { thumbnail: uploaded.url },
    });

    if (oldKey) {
      try {
        await this.fileService.delete(oldKey);
      } catch (error) {
        this.logger.warn(
          `Failed to delete old product thumbnail key=${oldKey}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return this.findOne(String(id));
  }

  async addImage(id: number, file: Express.Multer.File, sortOrder?: number) {
    await this.findActiveById(id);

    const uploaded = await this.fileService.upload(file, S3_FOLDERS.PRODUCTS);

    const maxSort = await this.prisma.productImage.aggregate({
      where: { productId: id },
      _max: { sortOrder: true },
    });

    await this.prisma.productImage.create({
      data: {
        productId: id,
        url: uploaded.url,
        sortOrder: sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    return this.findOne(String(id));
  }

  async removeImage(productId: number, imageId: number) {
    await this.findActiveById(productId);

    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });

    if (!image) {
      throw new NotFoundException('Product image not found');
    }

    await this.prisma.productImage.delete({ where: { id: imageId } });

    const key = this.fileService.extractKeyFromUrl(image.url);
    if (key) {
      try {
        await this.fileService.delete(key);
      } catch (error) {
        this.logger.warn(
          `Failed to delete product image key=${key}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return this.findOne(String(productId));
  }

  async addVariant(productId: number, dto: CreateVariantDto) {
    await this.findActiveById(productId);
    await this.assertSkuAvailable(dto.sku.trim());

    await this.prisma.$transaction(async (tx) => {
      // Switching from no-variant → has-variant: drop product-level inventory.
      await tx.inventory.deleteMany({
        where: { productId, variantId: null },
      });

      const variant = await tx.productVariant.create({
        data: {
          productId,
          name: dto.name.trim(),
          sku: dto.sku.trim(),
          price: new Prisma.Decimal(dto.price),
        },
      });

      await tx.inventory.create({
        data: {
          productId,
          variantId: variant.id,
          quantity: dto.quantity,
          warehouse: dto.warehouse?.trim() || null,
        },
      });
    });

    return this.findOne(String(productId));
  }

  async updateVariant(
    productId: number,
    variantId: number,
    dto: UpdateVariantDto,
  ) {
    await this.findOwnedVariant(productId, variantId);
    if (dto.sku !== undefined) {
      await this.assertSkuAvailable(dto.sku.trim(), variantId);
    }

    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.sku !== undefined && { sku: dto.sku.trim() }),
        ...(dto.price !== undefined && {
          price: new Prisma.Decimal(dto.price),
        }),
      },
    });

    return this.findOne(String(productId));
  }

  async removeVariant(productId: number, variantId: number) {
    await this.findOwnedVariant(productId, variantId);

    await this.prisma.$transaction(async (tx) => {
      const remaining = await tx.productVariant.count({
        where: { productId, id: { not: variantId } },
      });

      const inventory = await tx.inventory.findUnique({
        where: { variantId },
      });

      await tx.productVariant.delete({ where: { id: variantId } });

      // Last variant removed → restore product-level inventory (ERD rule).
      if (remaining === 0) {
        await tx.inventory.create({
          data: {
            productId,
            variantId: null,
            quantity: inventory?.quantity ?? 0,
            warehouse: inventory?.warehouse ?? null,
          },
        });
      }
    });

    return this.findOne(String(productId));
  }

  async updateInventory(productId: number, dto: UpdateInventoryDto) {
    await this.findActiveById(productId);

    const variantCount = await this.prisma.productVariant.count({
      where: { productId },
    });

    if (variantCount > 0) {
      if (dto.variantId == null) {
        throw new BadRequestException(
          'variantId is required because this product has variants',
        );
      }

      await this.findOwnedVariant(productId, dto.variantId);

      await this.prisma.inventory.update({
        where: { variantId: dto.variantId },
        data: {
          quantity: dto.quantity,
          ...(dto.warehouse !== undefined && {
            warehouse: dto.warehouse?.trim() || null,
          }),
        },
      });
    } else {
      if (dto.variantId != null) {
        throw new BadRequestException(
          'This product has no variants; omit variantId',
        );
      }

      const row = await this.prisma.inventory.findFirst({
        where: { productId, variantId: null },
      });

      if (!row) {
        await this.prisma.inventory.create({
          data: {
            productId,
            variantId: null,
            quantity: dto.quantity,
            warehouse: dto.warehouse?.trim() || null,
          },
        });
      } else {
        await this.prisma.inventory.update({
          where: { id: row.id },
          data: {
            quantity: dto.quantity,
            ...(dto.warehouse !== undefined && {
              warehouse: dto.warehouse?.trim() || null,
            }),
          },
        });
      }
    }

    return this.findOne(String(productId));
  }

  private async findMany(query: ListProductsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.q?.trim() && {
        name: { contains: query.q.trim(), mode: 'insensitive' },
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          inventory: true,
          variants: { include: { inventory: true } },
        },
      }),
    ]);

    return {
      items: items.map((p) => this.toListResponse(p)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  private async findActiveById(id: number) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  private async findActiveByIdOrSlug(idOrSlug: string): Promise<ProductDetail> {
    const asId = Number(idOrSlug);
    const where =
      Number.isInteger(asId) && asId > 0
        ? { OR: [{ id: asId }, { slug: idOrSlug }], deletedAt: null }
        : { slug: idOrSlug, deletedAt: null };

    const product = await this.prisma.product.findFirst({
      where,
      include: productDetailInclude,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  private async assertSkuAvailable(sku: string, excludeVariantId?: number) {
    const existing = await this.prisma.productVariant.findFirst({
      where: {
        sku,
        ...(excludeVariantId != null && { id: { not: excludeVariantId } }),
      },
      select: { id: true, productId: true },
    });

    if (existing) {
      throw new BadRequestException(`SKU "${sku}" is already used`);
    }
  }

  private async findOwnedVariant(productId: number, variantId: number) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });

    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }

    return variant;
  }

  private async assertCategoryExists(categoryId: number) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestException('Category not found');
    }
  }

  private assertPrices(price: number, discountPrice?: number | null) {
    if (discountPrice != null && discountPrice > price) {
      throw new BadRequestException(
        'discountPrice must be less than or equal to price',
      );
    }
  }

  private async resolveUniqueSlug(base: string, excludeId?: number) {
    const normalized = slugify(base);
    if (!normalized) {
      throw new BadRequestException('Invalid slug');
    }

    let candidate = normalized;
    let suffix = 2;

    while (true) {
      const existing = await this.prisma.product.findFirst({
        where: {
          slug: candidate,
          ...(excludeId != null && { id: { not: excludeId } }),
        },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }

      candidate = `${normalized}-${suffix}`.slice(0, 120);
      suffix += 1;
    }
  }

  private toListResponse(
    product: Prisma.ProductGetPayload<{
      include: {
        category: { select: { id: true; name: true; slug: true } };
        inventory: true;
        variants: { include: { inventory: true } };
      };
    }>,
  ) {
    return {
      id: product.id,
      categoryId: product.categoryId,
      category: product.category,
      name: product.name,
      slug: product.slug,
      thumbnail: product.thumbnail,
      price: Number(product.price),
      discountPrice:
        product.discountPrice != null ? Number(product.discountPrice) : null,
      soldCount: product.soldCount,
      ratingAvg: product.ratingAvg,
      status: product.status,
      stock: this.computeStock(product.inventory, product.variants),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private toDetailResponse(product: ProductDetail) {
    return {
      id: product.id,
      categoryId: product.categoryId,
      category: product.category,
      name: product.name,
      slug: product.slug,
      description: product.description,
      thumbnail: product.thumbnail,
      price: Number(product.price),
      discountPrice:
        product.discountPrice != null ? Number(product.discountPrice) : null,
      soldCount: product.soldCount,
      ratingAvg: product.ratingAvg,
      status: product.status,
      images: product.images.map((img) => ({
        id: img.id,
        url: img.url,
        sortOrder: img.sortOrder,
      })),
      variants: product.variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        price: Number(v.price),
        quantity: v.inventory?.quantity ?? 0,
        warehouse: v.inventory?.warehouse ?? null,
      })),
      inventory: product.inventory
        .filter((row) => row.variantId == null)
        .map((row) => ({
          id: row.id,
          quantity: row.quantity,
          warehouse: row.warehouse,
        })),
      stock: this.computeStock(product.inventory, product.variants),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private computeStock(
    inventory: { variantId: number | null; quantity: number }[],
    variants: { inventory: { quantity: number } | null }[],
  ) {
    if (variants.length > 0) {
      return variants.reduce(
        (sum, v) => sum + (v.inventory?.quantity ?? 0),
        0,
      );
    }

    return inventory
      .filter((row) => row.variantId == null)
      .reduce((sum, row) => sum + row.quantity, 0);
  }
}
