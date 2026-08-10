import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}
