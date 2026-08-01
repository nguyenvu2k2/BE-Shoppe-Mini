import { prisma } from './index';

export async function roleSeed() {
  const roles = [
    {
      name: 'ADMIN',
    },
    {
      name: 'CUSTOMER',
    },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: {
        name: role.name,
      },
      update: {},
      create: role,
    });
  }

  console.log('✔ Role Seeded');
}
