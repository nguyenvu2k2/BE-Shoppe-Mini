import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { resolveJwtSecret } from '../config/load-env';
import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';

/**
 * Shared JWT + AuthGuard + PermissionsGuard for all feature modules.
 * Registered once globally so controllers can use @UseGuards / @AuthPermissions
 * without re-registering JwtModule in every module.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: resolveJwtSecret(configService.get<string>('JWT_SECRET')),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  providers: [AuthGuard, PermissionsGuard],
  exports: [JwtModule, AuthGuard, PermissionsGuard],
})
export class JwtAuthModule {}
