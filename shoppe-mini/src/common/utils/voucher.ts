import { roundMoney } from './unit-price';

/** Thrown by computeDiscount when subtotal is below voucher.minOrderAmount. */
export const VOUCHER_MIN_ORDER_ERROR = 'MIN_ORDER_AMOUNT_NOT_MET';

export type DiscountVoucher = {
  type: 'PERCENT' | 'FIXED';
  value: number;
  minOrderAmount: number;
  maxDiscount: number | null;
};

/**
 * Order-level discount in VND. Does not check dates, quota, or isActive —
 * callers (preview / checkout) must validate eligibility first.
 *
 * PERCENT value is percent points (10 = 10%). Discount never exceeds subtotal.
 */
export function computeDiscount(
  subtotal: number,
  voucher: DiscountVoucher,
): number {
  if (subtotal < voucher.minOrderAmount) {
    throw new Error(VOUCHER_MIN_ORDER_ERROR);
  }

  let discount =
    voucher.type === 'PERCENT'
      ? roundMoney(subtotal * (voucher.value / 100))
      : roundMoney(voucher.value);

  if (voucher.maxDiscount != null) {
    discount = Math.min(discount, voucher.maxDiscount);
  }

  discount = Math.min(discount, subtotal);
  return roundMoney(Math.max(discount, 0));
}
