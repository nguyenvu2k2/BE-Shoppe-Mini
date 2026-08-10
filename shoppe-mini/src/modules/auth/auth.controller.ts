import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { SignInDto } from '../../common/dto/auth/sign-in.dto';
import { ForgotPasswordDto } from '../../common/dto/auth/forgot-password.dto';
import { ResetPasswordDto } from '../../common/dto/auth/reset-password.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from '../../common/dto/auth/register.dto';


type RequestWithCookies = Request & {

  cookies?: {

    accessToken?: string;

    refreshToken?: string;

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

  async signIn(

    @Body() signDto: SignInDto,

    @Res({ passthrough: true }) res: Response,

  ) {

    const user = await this.authService.validateUser(signDto.email, signDto.password);

    if (user instanceof UnauthorizedException) {

      throw user;

    }



    const tokens = await this.authService.signIn({

      id: user.id,

      email: user.email,

      role: user.roleId,

    });



    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return { user: tokens.user };

  }



  @Post('refresh')

  async refreshToken(

    @Req() req: RequestWithCookies,

    @Res({ passthrough: true }) res: Response,

  ) {

    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {

      throw new UnauthorizedException('No refresh token');

    }



    const payload = this.authService.verifyToken(refreshToken);

    const user = await this.authService.findUserById(payload.sub);



    if (!user) {

      throw new UnauthorizedException('User not found');

    }



    const tokens = await this.authService.signIn({

      id: user.id,

      email: user.email,

      role: user.roleId,

    });



    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return { user: tokens.user };

  }



  @Post('google')

  async googleLogin(

    @Body('code') code: string,

    @Res({ passthrough: true }) res: Response,

  ) {

    const user = await this.authService.validateGoogleUser(

      code,

      this.configService.getOrThrow<string>('GOOGLE_REDIRECT_URI'),

    );



    const tokens = await this.authService.signInWithUser({

      id: user.id,

      email: user.email,

      fullName: user.fullName,

      role: user.role ? { name: user.role.name } : null,

    });



    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return { user: tokens.user };

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
  signOut(@Res({ passthrough: true }) res: Response) {
    this.clearAuthCookies(res);
    return this.authService.signOut();
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  private cookieBaseOptions(path: string): CookieOptions {
    const isProd = this.configService.get('NODE_ENV') === 'production';

    return {

      httpOnly: true,

      secure: isProd,

      sameSite: isProd ? 'none' : 'lax',

      path,

    };

  }



  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {

    res.cookie('accessToken', accessToken, {

      ...this.cookieBaseOptions('/'),

      maxAge: 60 * 60 * 1000,

    });

    res.cookie('refreshToken', refreshToken, {

      ...this.cookieBaseOptions('/auth/refresh'),

      maxAge: 7 * 24 * 60 * 60 * 1000,

    });

  }



  private clearAuthCookies(res: Response) {

    res.clearCookie('accessToken', this.cookieBaseOptions('/'));

    res.clearCookie('refreshToken', this.cookieBaseOptions('/auth/refresh'));

  }

}

