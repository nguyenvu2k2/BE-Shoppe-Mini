import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { FileService } from '../files/file.service';
import { S3_FOLDERS } from '../files/s3.constants';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {}

  async findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: {
        role: true,
      },
    });
  }

  async getProfileById(id: number) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        role: { select: { name: true } },
      },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async updateProfile(id: number, data: { fullName?: string; phone?: string; avatar?: string }) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    if (!user) {
      return null;
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.avatar !== undefined && { avatar: data.avatar }),
      },
    });

    return this.getProfileById(id);
  }

  async changePassword(id: number, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    if (!user) {
      return null;
    }

    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account uses Google sign-in and has no local password',
      );
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { userId: id, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
    ]);

    return { message: 'Password changed successfully. Please sign in again.' };
  }

  async updateAvatar(id: number, file: Express.Multer.File) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    if (!user) {
      return null;
    }

    const oldKey = user.avatar
      ? this.fileService.extractKeyFromUrl(user.avatar)
      : null;

    const uploaded = await this.fileService.upload(file, S3_FOLDERS.AVATARS);

    await this.prisma.user.update({
      where: { id },
      data: { avatar: uploaded.url },
    });

    if (oldKey) {
      try {
        await this.fileService.delete(oldKey);
      } catch (error) {
        // DB already points to the new URL; keep request successful
        this.logger.warn(
          `Failed to delete old avatar key=${oldKey}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return this.getProfileById(id);
  }

}
