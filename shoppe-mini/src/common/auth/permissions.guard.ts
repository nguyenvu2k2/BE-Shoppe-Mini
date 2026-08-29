import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisKeys, REDIS_TTL } from '../../modules/redis/redis.keys';
import { RedisService } from '../../modules/redis/redis.service';
import type { PermissionName } from './permissions';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import type { RequestWithCookies } from './request-with-cookies.type';

/**
 * Checks that the authenticated user has every permission declared
 * via @RequirePermissions(...). No metadata → allow (AuthGuard alone is enough).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionName[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithCookies>();
    const userId = req.user?.sub;

    if (!userId) {
      throw new UnauthorizedException('No access token');
    }

    const cacheKey = RedisKeys.permissions(userId);
    let names = await this.redis.getJson<string[]>(cacheKey);

    if (!names) {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: {
          role: {
            select: {
              rolePermissions: {
                select: {
                  permission: { select: { name: true } },
                },
              },
            },
          },
        },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      names = user.role.rolePermissions.map((rp) => rp.permission.name);
      await this.redis.setJson(cacheKey, names, REDIS_TTL.permissions);
    }

    const owned = new Set(names);

    const missing = required.filter((name) => !owned.has(name));

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing permission(s): ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
