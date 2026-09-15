import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthPermissions } from '../../common/auth/auth-permissions.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CreateBannerDto } from '../../common/dto/banner/create-banner.dto';
import { ListBannersQueryDto } from '../../common/dto/banner/list-banners-query.dto';
import { ListPublicBannersQueryDto } from '../../common/dto/banner/list-public-banners-query.dto';
import { UpdateBannerDto } from '../../common/dto/banner/update-banner.dto';
import {
  S3_ALLOWED_MIME_TYPES,
  S3_MAX_FILE_SIZE_BYTES,
  type S3AllowedMimeType,
} from '../files/s3.constants';
import { BannerService } from './banner.service';

@Controller('banners')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class BannerController {
  constructor(private readonly bannerService: BannerService) {}

  // "manage" before public ":id" routes so Nest does not treat it as an id.

  @Get('manage')
  @AuthPermissions(PERMISSIONS.BANNER_READ)
  findManage(@Query() query: ListBannersQueryDto) {
    return this.bannerService.findManage(query);
  }

  @Get('manage/:id')
  @AuthPermissions(PERMISSIONS.BANNER_READ)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.bannerService.findOne(id);
  }

  @Post()
  @AuthPermissions(PERMISSIONS.BANNER_CREATE)
  create(@Body() dto: CreateBannerDto) {
    return this.bannerService.create(dto);
  }

  @Patch(':id')
  @AuthPermissions(PERMISSIONS.BANNER_UPDATE)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBannerDto,
  ) {
    return this.bannerService.update(id, dto);
  }

  @Delete(':id')
  @AuthPermissions(PERMISSIONS.BANNER_DELETE)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.bannerService.remove(id);
  }

  @Post(':id/image')
  @AuthPermissions(PERMISSIONS.BANNER_UPDATE)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: S3_MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (S3_ALLOWED_MIME_TYPES.includes(file.mimetype as S3AllowedMimeType)) {
          cb(null, true);
          return;
        }
        cb(
          new BadRequestException(
            `Invalid file type. Allowed: ${S3_ALLOWED_MIME_TYPES.join(', ')}`,
          ),
          false,
        );
      },
    }),
  )
  updateImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required (multipart field: file)');
    }

    return this.bannerService.updateImage(id, file);
  }

  /** Public: active, in-window banners for homepage (and later slots). */
  @Get()
  list(@Query() query: ListPublicBannersQueryDto) {
    return this.bannerService.listPublic(query.position);
  }
}
