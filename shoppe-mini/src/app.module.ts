import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { UserModule } from './modules/user/user.module';
import { AddressModule } from './modules/address/address.module';
import { FileModule } from './modules/files/file.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
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
    MailModule,
    UserModule,
    AddressModule,
    AuthModule,
    FileModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
