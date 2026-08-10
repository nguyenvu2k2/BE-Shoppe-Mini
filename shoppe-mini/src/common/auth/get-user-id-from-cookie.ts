import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RequestWithCookies } from './request-with-cookies.type';

export function getUserIdFromCookie(
  req: RequestWithCookies,
  jwtService: JwtService,
): number {
  const token = req.cookies?.accessToken;

  if (!token) {
    throw new UnauthorizedException('No access token');
  }

  try {
    const payload = jwtService.verify<{ sub: number }>(token);
    return payload.sub;
  } catch {
    throw new UnauthorizedException('Invalid token');
  }
}
