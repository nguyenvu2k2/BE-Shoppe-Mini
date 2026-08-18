-- Keep a single live VNPay PENDING row per order (newest wins).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY order_id
      ORDER BY updated_at DESC, id DESC
    ) AS rn
  FROM "payments"
  WHERE "method" = 'VNPAY' AND "status" = 'PENDING'
)
UPDATE "payments" AS p
SET
  "status" = 'FAILED',
  "response_code" = 'EXPIRED',
  "updated_at" = CURRENT_TIMESTAMP
FROM ranked
WHERE p.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX "payments_one_pending_vnpay_uidx"
ON "payments" ("order_id")
WHERE "method" = 'VNPAY' AND "status" = 'PENDING';
