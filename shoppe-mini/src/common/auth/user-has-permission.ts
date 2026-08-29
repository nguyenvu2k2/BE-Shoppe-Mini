import type { PrismaService } from '../../prisma/prisma.service';
import type { PermissionName } from './permissions';

export async function userHasPermission(
  prisma: PrismaService,
  userId: number,
  permission: PermissionName,
): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      role: {
        select: {
          rolePermissions: {
            select: { permission: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!user) {
    return false;
  }

  return user.role.rolePermissions.some(
    (rp) => rp.permission.name === permission,
  );
}
