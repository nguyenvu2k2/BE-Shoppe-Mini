import { prisma } from './seeds';
import { roleSeed } from './seeds/role.seed';
import { permissionSeed } from './seeds/permission.seed';
import { categorySeed } from './seeds/category.seed';
import { userSeed } from './seeds/user.seed';

async function main() {
  console.log('🌱 Start Seeding...');

  await roleSeed();

  await permissionSeed();

  await categorySeed();

  await userSeed();

  console.log('🎉 Seed Completed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
