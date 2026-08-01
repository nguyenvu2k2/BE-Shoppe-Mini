import { IsEmail, IsNotEmpty, MinLength, ValidateIf } from 'class-validator';

export class SignInDto {
  @IsEmail()
  email: string | undefined;

  @ValidateIf((dto: SignInDto) => dto.password !== undefined || !dto.passwordHash)
  @IsNotEmpty()
  @MinLength(6)
  password?: string;

  @ValidateIf((dto: SignInDto) => dto.passwordHash !== undefined || !dto.password)
  @IsNotEmpty()
  @MinLength(6)
  passwordHash?: string;
}
