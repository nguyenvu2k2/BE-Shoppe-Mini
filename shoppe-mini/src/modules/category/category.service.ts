import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Category } from '../../../generated/prisma/client';
import { CreateCategoryDto } from '../../common/dto/category/create-category.dto';
import { UpdateCategoryDto } from '../../common/dto/category/update-category.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { FileService } from '../files/file.service';
import { S3_FOLDERS } from '../files/s3.constants';
import { slugify } from '../../common/utils/slugify';
import { REDIS_TTL, RedisKeys } from '../redis/redis.keys';
import { RedisService } from '../redis/redis.service';

export type CategoryNode = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  children: CategoryNode[];
};

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
    private readonly redis: RedisService,
  ) {}

  async findAll() {
    return this.redis.getOrSetJson(RedisKeys.categoryList, REDIS_TTL.catalog, async () => {
      const categories = await this.prisma.category.findMany({
        where: { deletedAt: null },
        orderBy: [{ name: 'asc' }],
      });
      return categories.map((c) => this.toResponse(c));
    });
  }

  async findTree(): Promise<CategoryNode[]> {
    return this.redis.getOrSetJson(RedisKeys.categoryTree, REDIS_TTL.catalog, async () => {
      const categories = await this.prisma.category.findMany({
        where: { deletedAt: null },
        orderBy: [{ name: 'asc' }],
      });
      return this.buildTree(categories);
    });
  }

  async findOne(idOrSlug: string) {
    return this.redis.getOrSetJson(
      RedisKeys.categoryOne(idOrSlug),
      REDIS_TTL.catalog,
      async () => {
        const category = await this.findActiveByIdOrSlug(idOrSlug);
        return this.toResponse(category);
      },
    );
  }

  async create(dto: CreateCategoryDto) {
    if (dto.parentId != null) {
      await this.assertParentExists(dto.parentId);
    }

    const slug = await this.resolveUniqueSlug(dto.slug ?? slugify(dto.name));

    if (!slug) {
      throw new BadRequestException('Could not generate a valid slug from name');
    }

    const category = await this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        slug,
        parentId: dto.parentId ?? null,
      },
    });

    await this.redis.invalidateCatalog();
    return this.toResponse(category);
  }

  async update(id: number, dto: UpdateCategoryDto) {
    const existing = await this.findActiveById(id);

    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('Category cannot be its own parent');
      }

      if (dto.parentId !== null) {
        await this.assertParentExists(dto.parentId);
        await this.assertNotDescendant(id, dto.parentId);
      }
    }

    let nextSlug: string | undefined;
    if (dto.slug !== undefined) {
      nextSlug = await this.resolveUniqueSlug(dto.slug, id);
    } else if (dto.name !== undefined && dto.name.trim() !== existing.name) {
      // Keep existing slug unless client sends a new one — avoid breaking URLs.
      nextSlug = undefined;
    }

    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(nextSlug !== undefined && { slug: nextSlug }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
      },
    });

    await this.redis.invalidateCatalog();
    return this.toResponse(category);
  }

  async remove(id: number) {
    await this.findActiveById(id);

    const childCount = await this.prisma.category.count({
      where: { parentId: id, deletedAt: null },
    });

    if (childCount > 0) {
      throw new BadRequestException(
        'Cannot delete a category that still has child categories. Move or delete children first.',
      );
    }

    const productCount = await this.prisma.product.count({
      where: { categoryId: id, deletedAt: null },
    });

    if (productCount > 0) {
      throw new BadRequestException(
        'Cannot delete a category that still has products. Move or delete products first.',
      );
    }

    await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.redis.invalidateCatalog();
    return { message: 'Category deleted successfully' };
  }

  async updateImage(id: number, file: Express.Multer.File) {
    const existing = await this.findActiveById(id);

    const oldKey = existing.image
      ? this.fileService.extractKeyFromUrl(existing.image)
      : null;

    const uploaded = await this.fileService.upload(file, S3_FOLDERS.CATEGORIES);

    const category = await this.prisma.category.update({
      where: { id },
      data: { image: uploaded.url },
    });

    if (oldKey) {
      try {
        await this.fileService.delete(oldKey);
      } catch (error) {
        this.logger.warn(
          `Failed to delete old category image key=${oldKey}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    await this.redis.invalidateCatalog();
    return this.toResponse(category);
  }

  private async findActiveById(id: number) {
    const category = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  private async findActiveByIdOrSlug(idOrSlug: string) {
    const asId = Number(idOrSlug);
    const where =
      Number.isInteger(asId) && asId > 0
        ? { OR: [{ id: asId }, { slug: idOrSlug }], deletedAt: null }
        : { slug: idOrSlug, deletedAt: null };

    const category = await this.prisma.category.findFirst({ where });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  private async assertParentExists(parentId: number) {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { id: true },
    });

    if (!parent) {
      throw new BadRequestException('Parent category not found');
    }
  }

  /** Prevent cycles: newParent must not be under `categoryId` in the tree. */
  private async assertNotDescendant(categoryId: number, newParentId: number) {
    const all = await this.prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });

    const childrenByParent = new Map<number, number[]>();
    for (const row of all) {
      if (row.parentId == null) continue;
      const list = childrenByParent.get(row.parentId) ?? [];
      list.push(row.id);
      childrenByParent.set(row.parentId, list);
    }

    const stack = [...(childrenByParent.get(categoryId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === newParentId) {
        throw new BadRequestException(
          'Cannot move category under one of its descendants',
        );
      }
      stack.push(...(childrenByParent.get(current) ?? []));
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
      const existing = await this.prisma.category.findFirst({
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

  private buildTree(categories: Category[]): CategoryNode[] {
    const nodes = new Map<number, CategoryNode>();

    for (const c of categories) {
      nodes.set(c.id, { ...this.toResponse(c), children: [] });
    }

    const roots: CategoryNode[] = [];

    for (const c of categories) {
      const node = nodes.get(c.id)!;
      if (c.parentId != null && nodes.has(c.parentId)) {
        nodes.get(c.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  private toResponse(category: Category) {
    return {
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      slug: category.slug,
      image: category.image,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
