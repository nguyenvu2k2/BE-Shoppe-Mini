import type { Request } from 'express';
import type { JwtPayload } from './jwt-payload.type';

export type RequestWithCookies = Request & {
  cookies?: {
    accessToken?: string;
    refreshToken?: string;
  };
  user?: JwtPayload;
};
