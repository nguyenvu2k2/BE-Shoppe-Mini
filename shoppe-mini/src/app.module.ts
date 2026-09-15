import { join } from 'path';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { JwtAuthModule } from './common/auth/jwt-auth.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { UserModule } from './modules/user/user.module';
import { AddressModule } from './modules/address/address.module';
import { FileModule } from './modules/files/file.module';
import { CategoryModule } from './modules/category/category.module';
import { ProductModule } from './modules/product/product.module';
import { CartModule } from './modules/cart/cart.module';
import { VoucherModule } from './modules/voucher/voucher.module';
import { BannerModule } from './modules/banner/banner.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { hostEnvFile } from './common/config/load-env';

const envFile = hostEnvFile();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Image has no /app/.env. Skip the file so ConfigService reads process.env
      // injected by Compose / Railway / `docker run --env-file`.
      ignoreEnvFile: !envFile,
      envFilePath: envFile ? [envFile, join(process.cwd(), '.env')] : ['.env'],
      cache: true,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.get('NODE_ENV') !== 'production' ? 'debug' : 'info',
          transport:
            configService.get('NODE_ENV') !== 'production'
              ? {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  colorize: true,
                  translateTime: 'SYS:standard',
                },
              }
              : undefined,
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    JwtAuthModule,
    MailModule,
    UserModule,
    AddressModule,
    AuthModule,
    FileModule,
    CategoryModule,
    ProductModule,
    CartModule,
    VoucherModule,
    BannerModule,
    OrderModule,
    PaymentModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
