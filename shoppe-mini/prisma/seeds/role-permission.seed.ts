import { prisma } from './index';

const CUSTOMER_PERMISSIONS = ['product:read', 'category:read'] as const;

/**
 * Links roles ↔ permissions.
 * ADMIN: all permissions. CUSTOMER: catalog read only.
 */
export async function rolePermissionSeed() {
  const admin = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const customer = await prisma.role.findUnique({ where: { name: 'CUSTOMER' } });

  if (!admin || !customer) {
    throw new Error('Roles ADMIN/CUSTOMER must be seeded before role permissions');
  }

  const allPermissions = await prisma.permission.findMany({
    select: { id: true, name: true },
  });

  if (allPermissions.length === 0) {
    throw new Error('Permissions must be seeded before role permissions');
  }

  await prisma.rolePermission.createMany({
    data: allPermissions.map((p) => ({
      roleId: admin.id,
      permissionId: p.id,
    })),
    skipDuplicates: true,
  });

  const customerPermissionIds = allPermissions
    .filter((p) =>
      (CUSTOMER_PERMISSIONS as readonly string[]).includes(p.name),
    )
    .map((p) => p.id);

  await prisma.rolePermission.createMany({
    data: customerPermissionIds.map((permissionId) => ({
      roleId: customer.id,
      permissionId,
    })),
    skipDuplicates: true,
  });

  console.log(
    `✔ Role permissions: ADMIN → ${allPermissions.length}, CUSTOMER → ${customerPermissionIds.length}`,
  );
}
