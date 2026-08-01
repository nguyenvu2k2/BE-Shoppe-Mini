import { prisma } from './index';
import * as bcrypt from 'bcrypt';

export async function userSeed() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error('Missing SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD');
  }

  const password = await bcrypt.hash(adminPassword, 10);

  const adminRole = await prisma.role.findUnique({
    where: {
      name: 'ADMIN',
    },
  });

  if (!adminRole) return;

  await prisma.user.upsert({
    where: {
      email: adminEmail,
    },
    update: {
      passwordHash: password,
      fullName: 'Administrator',
      roleId: adminRole.id,
    },
    create: {
      email: adminEmail,
      passwordHash: password,
      fullName: 'Administrator',
      roleId: adminRole.id,
    },
  });

  console.log('✔ Admin Seeded');
}
