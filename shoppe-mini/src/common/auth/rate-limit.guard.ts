import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisKeys } from '../../modules/redis/redis.keys';
import { RedisService } from '../../modules/redis/redis.service';
import type { RequestWithCookies } from './request-with-cookies.type';
import {
  RATE_LIMIT_KEY,
  type RateLimitOptions,
} from './rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithCookies>();
    const id = this.clientId(req);
    const key = RedisKeys.rateLimit(options.scope, id);
    const count = await this.redis.incrWithTtl(key, options.windowSec);

    if (count == null) {
      return true;
    }

    if (count > options.max) {
      throw new HttpException(
        `Too many requests. Try again in ${options.windowSec} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private clientId(req: RequestWithCookies): string {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return (raw?.split(',')[0] ?? req.ip ?? 'unknown').trim();
  }
}
