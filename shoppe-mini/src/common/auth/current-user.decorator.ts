import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from './jwt-payload.type';
import type { RequestWithCookies } from './request-with-cookies.type';

/**
 * Read the authenticated user attached by AuthGuard.
 * @example @CurrentUser() user
 * @example @CurrentUser('sub') userId
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<RequestWithCookies>();
    const user = req.user;

    if (!user) {
      return undefined;
    }

    return data ? user[data] : user;
  },
);
