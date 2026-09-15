import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type Banner,
  type BannerPosition,
} from '../../../generated/prisma/client';
import { CreateBannerDto } from '../../common/dto/banner/create-banner.dto';
import { UpdateBannerDto } from '../../common/dto/banner/update-banner.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { FileService } from '../files/file.service';
import { S3_FOLDERS } from '../files/s3.constants';
import { REDIS_TTL, RedisKeys } from '../redis/redis.keys';
import { RedisService } from '../redis/redis.service';

export type ListBannersQuery = {
  page?: number;
  limit?: number;
  isActive?: boolean;
  position?: BannerPosition;
};

@Injectable()
export class BannerService {
  private readonly logger = new Logger(BannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
    private readonly redis: RedisService,
  ) {}

  async listPublic(position?: BannerPosition) {
    const cacheKey = RedisKeys.bannerList(position ?? 'all');

    return this.redis.getOrSetJson(cacheKey, REDIS_TTL.catalog, async () => {
      const now = new Date();
      const banners = await this.prisma.banner.findMany({
        where: {
          isActive: true,
          image: { not: null },
          ...(position && { position }),
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          ],
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });

      return banners.map((b) => this.toResponse(b));
    });
  }

  async findManage(query: ListBannersQuery = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.BannerWhereInput = {
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.position && { position: query.position }),
    };

    const [total, banners] = await this.prisma.$transaction([
      this.prisma.banner.count({ where }),
      this.prisma.banner.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    ]);

    return {
      items: banners.map((b) => this.toResponse(b)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(id: number) {
    const banner = await this.findByIdOrThrow(id);
    return this.toResponse(banner);
  }

  async create(dto: CreateBannerDto) {
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    this.assertSchedule(startsAt, endsAt);

    const banner = await this.prisma.banner.create({
      data: {
        title: dto.title.trim(),
        image: this.normalizeOptionalText(dto.image),
        link: this.normalizeOptionalText(dto.link),
        position: dto.position,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        startsAt,
        endsAt,
      },
    });

    await this.invalidateCache();
    return this.toResponse(banner);
  }

  async update(id: number, dto: UpdateBannerDto) {
    const existing = await this.findByIdOrThrow(id);

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

    this.assertSchedule(startsAt, endsAt);

    const banner = await this.prisma.banner.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.image !== undefined && {
          image: this.normalizeOptionalText(dto.image),
        }),
        ...(dto.link !== undefined && {
          link: this.normalizeOptionalText(dto.link),
        }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.startsAt !== undefined && { startsAt }),
        ...(dto.endsAt !== undefined && { endsAt }),
      },
    });

    await this.invalidateCache();
    return this.toResponse(banner);
  }

  async remove(id: number) {
    const existing = await this.findByIdOrThrow(id);

    await this.prisma.banner.delete({ where: { id } });
    await this.deleteStoredImage(existing.image);
    await this.invalidateCache();

    return { message: 'Banner deleted successfully' };
  }

  async updateImage(id: number, file: Express.Multer.File) {
    const existing = await this.findByIdOrThrow(id);
    const uploaded = await this.fileService.upload(file, S3_FOLDERS.BANNERS);

    const banner = await this.prisma.banner.update({
      where: { id },
      data: { image: uploaded.url },
    });

    await this.deleteStoredImage(existing.image);
    await this.invalidateCache();
    return this.toResponse(banner);
  }

  private async findByIdOrThrow(id: number) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) {
      throw new NotFoundException('Banner not found');
    }
    return banner;
  }

  private assertSchedule(startsAt: Date | null, endsAt: Date | null) {
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
  }

  private normalizeOptionalText(value?: string | null): string | null {
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async deleteStoredImage(url: string | null) {
    if (!url) {
      return;
    }

    const key = this.fileService.extractKeyFromUrl(url);
    if (!key) {
      return;
    }

    try {
      await this.fileService.delete(key);
    } catch (error) {
      this.logger.warn(
        `Failed to delete old banner image key=${key}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async invalidateCache() {
    await this.redis.delByPrefix(RedisKeys.bannerPrefix);
  }

  private toResponse(banner: Banner) {
    return {
      id: banner.id,
      title: banner.title,
      image: banner.image,
      link: banner.link,
      position: banner.position,
      sortOrder: banner.sortOrder,
      isActive: banner.isActive,
      startsAt: banner.startsAt,
      endsAt: banner.endsAt,
      createdAt: banner.createdAt,
      updatedAt: banner.updatedAt,
    };
  }
}
