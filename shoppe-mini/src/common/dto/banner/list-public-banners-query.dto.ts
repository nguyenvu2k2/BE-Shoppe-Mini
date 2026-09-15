import { BannerPosition } from '../../../../generated/prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListPublicBannersQueryDto {
  @IsOptional()
  @IsEnum(BannerPosition)
  position?: BannerPosition;
}
