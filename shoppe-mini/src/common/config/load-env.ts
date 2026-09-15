import { existsSync } from 'fs';
import { join } from 'path';

const LOCAL_FRONTEND = 'http://localhost:3000';

/** `.env` next to process cwd — present on the host, never inside the API image. */
export function hostEnvFile(): string | undefined {
  const path = join(process.cwd(), '.env');
  return existsSync(path) ? path : undefined;
}

/**
 * JWT secret for Nest. Docker images do not contain `.env` (.dockerignore).
 * Runtime must inject JWT_SECRET via compose env_file / environment / --env-file.
 */
export function resolveJwtSecret(fromConfig?: string): string {
  const secret = (fromConfig ?? process.env.JWT_SECRET ?? '').trim();
  if (secret) return secret;

  throw new Error(
    'JWT_SECRET is missing at runtime. The API image has no .env file. ' +
      'Pass it with docker compose (env_file + JWT_SECRET in .env next to the compose file) ' +
      'or `docker run --env-file .env`. Port 3001 only comes up after this is set.',
  );
}

function parseFrontendUrls(): string[] {
  return (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Primary FE origin — password-reset links, redirects. */
export function resolveFrontendUrl(): string {
  return parseFrontendUrls()[0] ?? LOCAL_FRONTEND;
}

/**
 * CORS / Socket.IO origins.
 * Production: FRONTEND_URL only (comma-separated allowed).
 * Non-production: always includes http://localhost:3000 so local FE works
 * even if .env still has the Vercel URL.
 */
export function resolveCorsOrigins(): string | string[] {
  const urls = parseFrontendUrls();
  if (process.env.NODE_ENV === 'production') {
    if (urls.length === 0) return LOCAL_FRONTEND;
    return urls.length === 1 ? urls[0] : urls;
  }

  const origins = new Set(urls.length ? urls : [LOCAL_FRONTEND]);
  origins.add(LOCAL_FRONTEND);
  const list = [...origins];
  return list.length === 1 ? list[0] : list;
}
