import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsVnPhone } from '../../utils/phone';

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsVnPhone()
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
