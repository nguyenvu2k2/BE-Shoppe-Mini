import { prisma } from './index';

import { userPermissions } from './permissions/user.permission';
import { productPermissions } from './permissions/product.permission';
import { categoryPermissions } from './permissions/category.permission';
import { orderPermissions } from './permissions/order.permission';
import { paymentPermissions } from './permissions/payment.permission';
import { voucherPermissions } from './permissions/voucher.permission';
import { bannerPermissions } from './permissions/banner.permission';

const permissions = [
  ...userPermissions,
  ...productPermissions,
  ...categoryPermissions,
  ...orderPermissions,
  ...paymentPermissions,
  ...voucherPermissions,
  ...bannerPermissions,
];

export async function permissionSeed() {
  await prisma.permission.createMany({
    data: permissions,
    skipDuplicates: true,
  });

  console.log(`✔ Seeded ${permissions.length} permissions`);
}
