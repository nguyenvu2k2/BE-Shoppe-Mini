import { computeDiscount, VOUCHER_MIN_ORDER_ERROR } from './voucher';

const percent10 = {
  type: 'PERCENT' as const,
  value: 10,
  minOrderAmount: 0,
  maxDiscount: null,
};

describe('computeDiscount', () => {
  it('takes 10% of subtotal', () => {
    expect(computeDiscount(100_000, percent10)).toBe(10_000);
  });

  it('caps percent by maxDiscount', () => {
    expect(
      computeDiscount(100_000, { ...percent10, maxDiscount: 5_000 }),
    ).toBe(5_000);
  });

  it('applies a FIXED amount', () => {
    expect(
      computeDiscount(100_000, {
        type: 'FIXED',
        value: 20_000,
        minOrderAmount: 0,
        maxDiscount: null,
      }),
    ).toBe(20_000);
  });

  it('does not discount more than subtotal (FIXED)', () => {
    expect(
      computeDiscount(20_000, {
        type: 'FIXED',
        value: 50_000,
        minOrderAmount: 0,
        maxDiscount: null,
      }),
    ).toBe(20_000);
  });

  it('rejects subtotal below minOrderAmount', () => {
    expect(() =>
      computeDiscount(10_000, { ...percent10, minOrderAmount: 50_000 }),
    ).toThrow(VOUCHER_MIN_ORDER_ERROR);
  });
});
