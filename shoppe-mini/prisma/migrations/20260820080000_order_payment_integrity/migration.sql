-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'RETURNED';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "needs_refund" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "payments_needs_refund_idx" ON "payments"("needs_refund");

-- Inventory cannot go negative (oversell / restore bugs)
ALTER TABLE "inventories"
  ADD CONSTRAINT "inventories_quantity_non_negative" CHECK (quantity >= 0);

-- Keep cart/order lines from vanishing (and losing restore targets) when a variant is deleted
ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_variant_id_fkey";
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_items" DROP CONSTRAINT "order_items_variant_id_fkey";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
