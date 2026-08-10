import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phone?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  addressLine?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ward?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  district?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  province?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
