import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from './jwt-payload.type';
import type { RequestWithCookies } from './request-with-cookies.type';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithCookies>();
    const token = req.cookies?.accessToken;

    if (!token) {
      throw new UnauthorizedException('No access token');
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);

      if (!payload?.sub) {
        throw new UnauthorizedException('Invalid token');
      }

      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
