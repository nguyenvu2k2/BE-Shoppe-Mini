import {
  BadRequestException,
  Controller,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { memoryStorage } from 'multer';
import { getUserIdFromCookie } from '../../common/auth/get-user-id-from-cookie';
import type { RequestWithCookies } from '../../common/auth/request-with-cookies.type';
import { FileService } from './file.service';
import {
  S3_ALLOWED_FOLDERS,
  S3_ALLOWED_MIME_TYPES,
  S3_MAX_FILE_SIZE_BYTES,
  type S3AllowedMimeType,
  type S3Folder,
} from './s3.constants';

@Controller('files')
export class FileController {
  constructor(
    private readonly fileService: FileService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * POST /files/upload?folder=avatars
   * multipart field name: `file`
   * Requires accessToken cookie.
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
    @Req() req: RequestWithCookies,
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder?: string,
  ) {
    // Auth first — reject anonymous uploads even if multipart parsing succeeded
    getUserIdFromCookie(req, this.jwtService);

    if (!file) {
      throw new BadRequestException('File is required (multipart field: file)');
    }

    if (!folder || !S3_ALLOWED_FOLDERS.includes(folder as S3Folder)) {
      throw new BadRequestException(
        `Invalid or missing folder. Allowed: ${S3_ALLOWED_FOLDERS.join(', ')}`,
      );
    }

    return this.fileService.upload(file, folder as S3Folder);
  }
}
