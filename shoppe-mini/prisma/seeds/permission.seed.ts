import { prisma } from './index';

import { userPermissions } from './permissions/user.permission';
import { productPermissions } from './permissions/product.permission';
import { categoryPermissions } from './permissions/category.permission';

const permissions = [...userPermissions, ...productPermissions, ...categoryPermissions];

export async function permissionSeed() {
  await prisma.permission.createMany({
    data: permissions,
    skipDuplicates: true,
  });

  console.log(`✔ Seeded ${permissions.length} permissions`);
}
