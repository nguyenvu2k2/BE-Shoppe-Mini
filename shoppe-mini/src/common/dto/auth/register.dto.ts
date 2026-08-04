import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string | undefined;

  @IsNotEmpty()
  @MinLength(6)
  password: string | undefined;

  @IsNotEmpty()
  fullName: string | undefined;
}
