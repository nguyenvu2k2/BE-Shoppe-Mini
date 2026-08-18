import { SetMetadata } from '@nestjs/common';
import type { PermissionName } from './permissions';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declare permissions required for a route (AND logic).
 * Must be used together with AuthGuard + PermissionsGuard.
 *
 * @example
 * @UseGuards(AuthGuard, PermissionsGuard)
 * @RequirePermissions(PERMISSIONS.CATEGORY_CREATE)
 */
export const RequirePermissions = (...permissions: PermissionName[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
