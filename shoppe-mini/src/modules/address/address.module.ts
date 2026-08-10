import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  controllers: [AddressController],
  providers: [AddressService],
})
export class AddressModule {}
