import { roundMoney } from './unit-price';

/** Flat shipping from SHIPPING_FEE_VND (default 0). */
export function computeShippingFee(): number {
  const raw = process.env.SHIPPING_FEE_VND;
  if (raw == null || raw === '') {
    return 0;
  }

  const fee = Number(raw);
  if (!Number.isFinite(fee) || fee < 0) {
    return 0;
  }

  return roundMoney(fee);
}
