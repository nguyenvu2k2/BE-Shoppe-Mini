import { prisma } from './index';

export async function categorySeed() {
  const categories = [
    {
      name: 'Điện thoại',
      slug: 'dien-thoai',
    },
    {
      name: 'Laptop',
      slug: 'laptop',
    },
    {
      name: 'Thời trang',
      slug: 'thoi-trang',
    },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: {
        slug: category.slug,
      },
      update: {},
      create: category,
    });
  }

  console.log('✔ Category Seeded');
}
