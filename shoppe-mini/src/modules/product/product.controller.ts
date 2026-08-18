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
import { CreateProductDto } from '../../common/dto/product/create-product.dto';
import { ListProductsQueryDto } from '../../common/dto/product/list-products-query.dto';
import { UpdateProductDto } from '../../common/dto/product/update-product.dto';
import {
  CreateVariantDto,
  UpdateInventoryDto,
  UpdateVariantDto,
} from '../../common/dto/product/variant-inventory.dto';
import {
  S3_ALLOWED_MIME_TYPES,
  S3_MAX_FILE_SIZE_BYTES,
  type S3AllowedMimeType,
} from '../files/s3.constants';
import { ProductService } from './product.service';

const imageUploadInterceptor = FileInterceptor('file', {
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
});

@Controller('products')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  /** Public catalog: ACTIVE products only. */
  @Get()
  list(@Query() query: ListProductsQueryDto) {
    return this.productService.findPublic(query);
  }

  /** Admin catalog: filter by any status. */
  @Get('manage')
  @AuthPermissions(PERMISSIONS.PRODUCT_READ)
  manage(@Query() query: ListProductsQueryDto) {
    return this.productService.findManage(query);
  }

  /** Public detail: ACTIVE only. */
  @Get(':idOrSlug')
  detail(@Param('idOrSlug') idOrSlug: string) {
    return this.productService.findOne(idOrSlug, { publicOnly: true });
  }

  @Post()
  @AuthPermissions(PERMISSIONS.PRODUCT_CREATE)
  create(@Body() dto: CreateProductDto) {
    return this.productService.create(dto);
  }

  @Patch(':id')
  @AuthPermissions(PERMISSIONS.PRODUCT_UPDATE)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productService.update(id, dto);
  }

  @Delete(':id')
  @AuthPermissions(PERMISSIONS.PRODUCT_DELETE)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.productService.remove(id);
  }

  @Post(':id/thumbnail')
  @AuthPermissions(PERMISSIONS.PRODUCT_UPDATE)
  @UseInterceptors(imageUploadInterceptor)
  updateThumbnail(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required (multipart field: file)');
    }
    return this.productService.updateThumbnail(id, file);
  }

  @Post(':id/images')
  @AuthPermissions(PERMISSIONS.PRODUCT_UPDATE)
  @UseInterceptors(imageUploadInterceptor)
  addImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required (multipart field: file)');
    }
    return this.productService.addImage(id, file);
  }

  @Delete(':id/images/:imageId')
  @AuthPermissions(PERMISSIONS.PRODUCT_UPDATE)
  removeImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('imageId', ParseIntPipe) imageId: number,
  ) {
    return this.productService.removeImage(id, imageId);
  }

  @Post(':id/variants')
  @AuthPermissions(PERMISSIONS.PRODUCT_UPDATE)
  addVariant(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateVariantDto,
  ) {
    return this.productService.addVariant(id, dto);
  }

  @Patch(':id/variants/:variantId')
  @AuthPermissions(PERMISSIONS.PRODUCT_UPDATE)
  updateVariant(
    @Param('id', ParseIntPipe) id: number,
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productService.updateVariant(id, variantId, dto);
  }

  @Delete(':id/variants/:variantId')
  @AuthPermissions(PERMISSIONS.PRODUCT_UPDATE)
  removeVariant(
    @Param('id', ParseIntPipe) id: number,
    @Param('variantId', ParseIntPipe) variantId: number,
  ) {
    return this.productService.removeVariant(id, variantId);
  }

  @Patch(':id/inventory')
  @AuthPermissions(PERMISSIONS.PRODUCT_UPDATE)
  updateInventory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInventoryDto,
  ) {
    return this.productService.updateInventory(id, dto);
  }
}
