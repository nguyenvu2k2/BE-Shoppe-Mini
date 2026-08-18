import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';
import type { PermissionName } from './permissions';
import { RequirePermissions } from './require-permissions.decorator';

/**
 * Shortcut: AuthGuard + PermissionsGuard + required permissions.
 *
 * @example
 * @AuthPermissions(PERMISSIONS.CATEGORY_CREATE)
 * create() { ... }
 */
export function AuthPermissions(...permissions: PermissionName[]) {
  return applyDecorators(
    UseGuards(AuthGuard, PermissionsGuard),
    RequirePermissions(...permissions),
  );
}
