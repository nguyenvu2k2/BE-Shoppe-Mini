import type { Prisma } from '../../../generated/prisma/client';

/** Hoàn kho từng dòng đơn. Dùng khi hủy / hết hạn VNPay. */
export async function restoreInventory(
  tx: Prisma.TransactionClient,
  items: { productId: number; variantId: number | null; quantity: number }[],
) {
  for (const item of items) {
    if (item.variantId != null) {
      await tx.inventory.updateMany({
        where: { variantId: item.variantId },
        data: { quantity: { increment: item.quantity } },
      });
    } else {
      await tx.inventory.updateMany({
        where: { productId: item.productId, variantId: null },
        data: { quantity: { increment: item.quantity } },
      });
    }
  }
}
