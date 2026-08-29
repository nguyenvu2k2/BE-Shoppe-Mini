/** Prefix + TTL. Redis is a cache/queue, not the source of truth. */
export const REDIS_PREFIX = 'shoppe';

export const REDIS_TTL = {
  /** Public catalog. Mutations delete keys; TTL is a safety net. */
  catalog: 60,
  /** RBAC snapshot per user. */
  permissions: 300,
} as const;

export const RedisKeys = {
  productList: (queryKey: string) => `${REDIS_PREFIX}:prod:list:${queryKey}`,
  productOne: (idOrSlug: string) => `${REDIS_PREFIX}:prod:one:${idOrSlug}`,
  categoryList: `${REDIS_PREFIX}:cat:list`,
  categoryTree: `${REDIS_PREFIX}:cat:tree`,
  categoryOne: (idOrSlug: string) => `${REDIS_PREFIX}:cat:one:${idOrSlug}`,
  permissions: (userId: number) => `${REDIS_PREFIX}:perm:${userId}`,
  rateLimit: (scope: string, id: string) =>
    `${REDIS_PREFIX}:rl:${scope}:${id}`,
  prodPrefix: `${REDIS_PREFIX}:prod:`,
  catPrefix: `${REDIS_PREFIX}:cat:`,
} as const;

export function productListQueryKey(query: {
  page?: number;
  limit?: number;
  categoryId?: number;
  q?: string;
  status?: string;
}): string {
  return [
    query.page ?? 1,
    query.limit ?? 20,
    query.categoryId ?? '',
    (query.q ?? '').trim().toLowerCase(),
    query.status ?? 'ACTIVE',
  ].join('|');
}
