import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { memoryStorage } from 'multer';
import { getUserIdFromCookie } from '../../common/auth/get-user-id-from-cookie';
import type { RequestWithCookies } from '../../common/auth/request-with-cookies.type';
import { UpdateProfileDto } from '../../common/dto/user/update-profile.dto';
import { ChangePasswordDto } from '../../common/dto/user/change-password.dto';
import { UserService } from './user.service';
import {
  S3_ALLOWED_MIME_TYPES,
  S3_MAX_FILE_SIZE_BYTES,
  type S3AllowedMimeType,
} from '../files/s3.constants';

@Controller('users')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('me')
  async getMe(@Req() req: RequestWithCookies) {
    const userId = getUserIdFromCookie(req, this.jwtService);
    const profile = await this.userService.getProfileById(userId);

    if (!profile) {
      throw new UnauthorizedException('User not found');
    }

    return profile;
  }

  @Patch('me')
  async updateMe(@Req() req: RequestWithCookies, @Body() dto: UpdateProfileDto) {
    const userId = getUserIdFromCookie(req, this.jwtService);
    const profile = await this.userService.updateProfile(userId, dto);

    if (!profile) {
      throw new UnauthorizedException('User not found');
    }

    return profile;
  }

  @Patch('me/password')
  async changePassword(@Req() req: RequestWithCookies, @Body() dto: ChangePasswordDto) {
    const userId = getUserIdFromCookie(req, this.jwtService);
    const result = await this.userService.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );

    if (!result) {
      throw new UnauthorizedException('User not found');
    }

    return result;
  }

  @Post('me/avatar')
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
  async updateAvatar(
    @Req() req: RequestWithCookies,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userId = getUserIdFromCookie(req, this.jwtService);

    if (!file) {
      throw new BadRequestException('File is required (multipart field: file)');
    }

    const profile = await this.userService.updateAvatar(userId, file);

    if (!profile) {
      throw new UnauthorizedException('User not found');
    }

    return profile;
  }
}

