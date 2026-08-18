import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { UpdateProfileDto } from '../../common/dto/user/update-profile.dto';
import { ChangePasswordDto } from '../../common/dto/user/change-password.dto';
import { UserService } from './user.service';
import {
  S3_ALLOWED_MIME_TYPES,
  S3_MAX_FILE_SIZE_BYTES,
  type S3AllowedMimeType,
} from '../files/s3.constants';

@Controller('users')
@UseGuards(AuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async getMe(@CurrentUser('sub') userId: number) {
    const profile = await this.userService.getProfileById(userId);

    if (!profile) {
      throw new UnauthorizedException('User not found');
    }

    return profile;
  }

  @Patch('me')
  async updateMe(
    @CurrentUser('sub') userId: number,
    @Body() dto: UpdateProfileDto,
  ) {
    const profile = await this.userService.updateProfile(userId, dto);

    if (!profile) {
      throw new UnauthorizedException('User not found');
    }

    return profile;
  }

  @Patch('me/password')
  async changePassword(
    @CurrentUser('sub') userId: number,
    @Body() dto: ChangePasswordDto,
  ) {
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
    @CurrentUser('sub') userId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
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
