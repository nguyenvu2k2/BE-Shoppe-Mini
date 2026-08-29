import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { RateLimitGuard } from '../../common/auth/rate-limit.guard';

@Module({
  imports: [MailModule, PrismaModule, UserModule],
  controllers: [AuthController],
  providers: [AuthService, RateLimitGuard],
  exports: [AuthService],
})
export class AuthModule {}
