import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { userHasPermission } from '../../common/auth/user-has-permission';
import { PrismaService } from '../../prisma/prisma.service';
import { FileService } from './file.service';
import {
  S3_ALLOWED_FOLDERS,
  S3_ALLOWED_MIME_TYPES,
  S3_FOLDERS,
  S3_MAX_FILE_SIZE_BYTES,
  type S3AllowedMimeType,
  type S3Folder,
} from './s3.constants';

@Controller('files')
@UseGuards(AuthGuard)
export class FileController {
  constructor(
    private readonly fileService: FileService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /files/upload?folder=avatars
   * multipart field name: `file`
   * Requires accessToken cookie.
   * products/categories folders require catalog update permissions.
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: S3_MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          S3_ALLOWED_MIME_TYPES.includes(file.mimetype as S3AllowedMimeType)
        ) {
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
  async upload(
    @CurrentUser('sub') userId: number,
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required (multipart field: file)');
    }

    if (!folder || !S3_ALLOWED_FOLDERS.includes(folder as S3Folder)) {
      throw new BadRequestException(
        `Invalid or missing folder. Allowed: ${S3_ALLOWED_FOLDERS.join(', ')}`,
      );
    }

    await this.assertFolderAccess(userId, folder as S3Folder);

    return this.fileService.upload(file, folder as S3Folder);
  }

  private async assertFolderAccess(userId: number, folder: S3Folder) {
    if (folder === S3_FOLDERS.AVATARS || folder === S3_FOLDERS.TEMP) {
      return;
    }

    const required =
      folder === S3_FOLDERS.PRODUCTS
        ? PERMISSIONS.PRODUCT_UPDATE
        : PERMISSIONS.CATEGORY_UPDATE;

    const allowed = await userHasPermission(this.prisma, userId, required);
    if (!allowed) {
      throw new ForbiddenException(`Missing permission: ${required}`);
    }
  }
}
