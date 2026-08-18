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
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthPermissions } from '../../common/auth/auth-permissions.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CreateCategoryDto } from '../../common/dto/category/create-category.dto';
import { UpdateCategoryDto } from '../../common/dto/category/update-category.dto';
import {
  S3_ALLOWED_MIME_TYPES,
  S3_MAX_FILE_SIZE_BYTES,
  type S3AllowedMimeType,
} from '../files/s3.constants';
import { CategoryService } from './category.service';

@Controller('categories')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  /** Public: flat list of active categories. */
  @Get()
  list() {
    return this.categoryService.findAll();
  }

  /** Public: nested parent → children tree. */
  @Get('tree')
  tree() {
    return this.categoryService.findTree();
  }

  /** Public: detail by numeric id or slug. */
  @Get(':idOrSlug')
  detail(@Param('idOrSlug') idOrSlug: string) {
    return this.categoryService.findOne(idOrSlug);
  }

  @Post()
  @AuthPermissions(PERMISSIONS.CATEGORY_CREATE)
  create(@Body() dto: CreateCategoryDto) {
    return this.categoryService.create(dto);
  }

  @Patch(':id')
  @AuthPermissions(PERMISSIONS.CATEGORY_UPDATE)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoryService.update(id, dto);
  }

  @Delete(':id')
  @AuthPermissions(PERMISSIONS.CATEGORY_DELETE)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.categoryService.remove(id);
  }

  @Post(':id/image')
  @AuthPermissions(PERMISSIONS.CATEGORY_UPDATE)
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

    return this.categoryService.updateImage(id, file);
  }
}
