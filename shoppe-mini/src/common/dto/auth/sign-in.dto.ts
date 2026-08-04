import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class SignInDto {
  @IsEmail()
  email: string | undefined;

  @IsNotEmpty()
  @MinLength(6)
  password: string | undefined;
}
