import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from './jwt-payload.type';
import type { RequestWithCookies } from './request-with-cookies.type';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

      const user = await this.prisma.user.findFirst({
        where: { id: payload.sub, deletedAt: null },
        select: { id: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      req.user = payload;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
