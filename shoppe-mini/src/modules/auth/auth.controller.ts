import { Body, Controller, Post, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { SignInDto } from '../../common/dto/auth/sign-in.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from '../../common/dto/auth/register.dto';

@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('signin')
  async signIn(@Body() signDto: SignInDto) {
    const password = signDto.password ?? signDto.passwordHash;
    const user = await this.authService.validateUser(signDto.email, password);
    if (user instanceof UnauthorizedException) {
      throw user;
    }
    return this.authService.signIn({ id: user.id, email: user.email, role: user.roleId });
  }

  @Post('refresh')
  async refreshToken(
    @Body('refreshToken') refreshToken: string
  ) {
    const payload = this.authService.verifyToken(refreshToken);
    if (payload instanceof UnauthorizedException) {
      return payload;
    }
    const user = await this.authService.findUserById(payload.sub);
    if (user instanceof UnauthorizedException) {
      return user;
    }
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return this.authService.signIn({ id: user.id, email: user.email, role: user.roleId })
  }

  @Post('signout')
  signOut() {
    return this.authService.signOut();
  }
}
