import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { AuthGuard } from '../../common/auth/auth.guard';
import { AuthPermissions } from '../../common/auth/auth-permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { RateLimit } from '../../common/auth/rate-limit.decorator';
import { RateLimitGuard } from '../../common/auth/rate-limit.guard';
import type { RequestWithCookies } from '../../common/auth/request-with-cookies.type';
import { SignInDto } from '../../common/dto/auth/sign-in.dto';
import { ForgotPasswordDto } from '../../common/dto/auth/forgot-password.dto';
import { ResetPasswordDto } from '../../common/dto/auth/reset-password.dto';
import { AuthService, type SessionMeta } from './auth.service';
import { RegisterDto } from '../../common/dto/auth/register.dto';

/** Cookie path so both /auth/refresh and /auth/signout receive the refresh token. */
const REFRESH_COOKIE_PATH = '/auth';

@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'register', max: 10, windowSec: 3600 })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('signin')
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'signin', max: 10, windowSec: 900 })
  async signIn(
    @Body() signDto: SignInDto,
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(signDto.email, signDto.password);

    const tokens = await this.authService.signIn(
      {
        id: user.id,
        email: user.email,
        role: user.roleId,
      },
      this.getSessionMeta(req),
    );

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

    const tokens = await this.authService.refresh(refreshToken, this.getSessionMeta(req));

    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { user: tokens.user };
  }

  @Post('google')
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'google', max: 20, windowSec: 900 })
  async googleLogin(
    @Body('code') code: string,
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateGoogleUser(
      code,
      this.configService.getOrThrow<string>('GOOGLE_REDIRECT_URI'),
    );

    const tokens = await this.authService.signInWithUser(
      {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role ? { name: user.role.name } : null,
      },
      this.getSessionMeta(req),
    );

    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { user: tokens.user };
  }

  @Get('profile')
  @UseGuards(AuthGuard)
  async getProfile(@CurrentUser('sub') userId: number) {
    const user = await this.authService.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { passwordHash: _passwordHash, ...result } = user;
    void _passwordHash;
    return result;
  }

  /** List permissions of the current user (for FE / debugging RBAC). */
  @Get('permissions')
  @UseGuards(AuthGuard)
  async getPermissions(@CurrentUser('sub') userId: number) {
    const result = await this.authService.getPermissionsForUser(userId);
    if (!result) {
      throw new UnauthorizedException('User not found');
    }
    return result;
  }

  /**
   * Smoke-check for RBAC: only roles with `user:read` (ADMIN after seed).
   * CUSTOMER should receive 403.
   */
  @Get('admin-check')
  @AuthPermissions(PERMISSIONS.USER_READ)
  adminCheck(@CurrentUser('role') role: string) {
    return {
      ok: true,
      role,
      message: 'RBAC permission check passed',
    };
  }

  @Post('signout')
  async signOut(
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.signOut(req.cookies?.refreshToken);
    this.clearAuthCookies(res);
    return { message: 'Signed out successfully' };
  }

  @Post('forgot-password')
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'forgot', max: 5, windowSec: 900 })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  private getSessionMeta(req: RequestWithCookies): SessionMeta {
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(',')[0]?.trim();

    return {
      ipAddress: forwardedIp || req.ip,
      userAgent: req.headers['user-agent'],
    };
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
      ...this.cookieBaseOptions(REFRESH_COOKIE_PATH),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie('accessToken', this.cookieBaseOptions('/'));
    // Clear both new and legacy paths so old cookies do not linger after deploy.
    res.clearCookie('refreshToken', this.cookieBaseOptions(REFRESH_COOKIE_PATH));
    res.clearCookie('refreshToken', this.cookieBaseOptions('/auth/refresh'));
  }
}
