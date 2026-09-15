import { BannerPosition } from '../../../../generated/prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBannerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  /** Public image URL from `/files/upload?folder=banners`. Omit and use POST :id/image. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  image?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  link?: string;

  @IsOptional()
  @IsEnum(BannerPosition)
  position?: BannerPosition;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
