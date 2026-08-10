import type { Request } from 'express';

export type RequestWithCookies = Request & {
  cookies?: {
    accessToken?: string;
  };
};
