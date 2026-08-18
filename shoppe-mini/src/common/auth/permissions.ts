/**
 * Canonical permission names used by seeds + API guards.
 * Keep in sync with prisma/seeds/permissions/*.permission.ts
 */
export const PERMISSIONS = {
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',

  PRODUCT_CREATE: 'product:create',
  PRODUCT_READ: 'product:read',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',

  CATEGORY_CREATE: 'category:create',
  CATEGORY_READ: 'category:read',
  CATEGORY_UPDATE: 'category:update',
  CATEGORY_DELETE: 'category:delete',

  ORDER_READ: 'order:read',
  ORDER_UPDATE: 'order:update',

  PAYMENT_READ: 'payment:read',
  PAYMENT_UPDATE: 'payment:update',
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
