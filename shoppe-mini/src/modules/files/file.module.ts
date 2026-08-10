import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { FileController } from './file.controller';
import { FileService } from './file.service';

@Global()
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
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
