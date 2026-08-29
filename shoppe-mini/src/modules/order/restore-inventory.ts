import type { Prisma } from '../../../generated/prisma/client';

export class InventoryRestoreError extends Error {
  constructor(
    readonly productId: number,
    readonly variantId: number | null,
  ) {
    super(
      `Failed to restore inventory for product ${productId} variant ${variantId}`,
    );
    this.name = 'InventoryRestoreError';
  }
}

/** Hoàn kho từng dòng đơn. Dùng khi hủy / hết hạn / hoàn hàng. */
export async function restoreInventory(
  tx: Prisma.TransactionClient,
  items: { productId: number; variantId: number | null; quantity: number }[],
) {
  for (const item of items) {
    const updated =
      item.variantId != null
        ? await tx.inventory.updateMany({
            where: { variantId: item.variantId },
            data: { quantity: { increment: item.quantity } },
          })
        : await tx.inventory.updateMany({
            where: { productId: item.productId, variantId: null },
            data: { quantity: { increment: item.quantity } },
          });

    if (updated.count === 0) {
      throw new InventoryRestoreError(item.productId, item.variantId);
    }
  }
}

export async function adjustSoldCount(
  tx: Prisma.TransactionClient,
  items: { productId: number; quantity: number }[],
  direction: 'increment' | 'decrement',
) {
  for (const item of items) {
    if (direction === 'increment') {
      await tx.product.update({
        where: { id: item.productId },
        data: { soldCount: { increment: item.quantity } },
      });
      continue;
    }

    await tx.product.updateMany({
      where: { id: item.productId, soldCount: { gte: item.quantity } },
      data: { soldCount: { decrement: item.quantity } },
    });
  }
}
