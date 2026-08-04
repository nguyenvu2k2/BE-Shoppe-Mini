import { Body, Controller, Get, Post, Req, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignInDto } from '../../common/dto/auth/sign-in.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from '../../common/dto/auth/register.dto';
import { Request } from 'express';

type RequestWithCookies = Request & {
  cookies?: {
    accessToken?: string;
    [key: string]: string | undefined;
  };
};
@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) { }

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('signin')
  async signIn(@Body() signDto: SignInDto) {
    const user = await this.authService.validateUser(signDto.email, signDto.password);
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

  @Post('google')
  async googleLogin(@Body('code') code: string) {
    const user = await this.authService.validateGoogleUser(
      code,
      process.env.GOOGLE_REDIRECT_URI!,
    );

    return this.authService.signInWithUser({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role ? { name: user.role.name } : null,
    })
  }

  @Get('profile')
  async getProfile(@Req() req: RequestWithCookies) {
    const token = req.cookies?.accessToken;
    if (!token) {
      throw new UnauthorizedException('No access token');
    }

    const payload = this.authService.verifyToken(token);
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.authService.findUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { passwordHash: _passwordHash, ...result } = user;
    void _passwordHash;
    return result;
  }

  @Post('signout')
  signOut() {
    return this.authService.signOut();
  }

}
