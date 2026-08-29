import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsVnPhone } from '../../utils/phone';

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  @IsVnPhone()
  phone: string;

  @IsString()
  @IsNotEmpty()
  addressLine: string;

  @IsString()
  @IsNotEmpty()
  ward: string;

  @IsString()
  @IsNotEmpty()
  district: string;

  @IsString()
  @IsNotEmpty()
  province: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
