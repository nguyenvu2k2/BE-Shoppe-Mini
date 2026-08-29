import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsVnPhone } from '../../utils/phone';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @IsOptional()
  @IsString()
  @IsVnPhone()
  phone?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}
