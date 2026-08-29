/** Round VND/money to 2 decimal places. */
export function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function toNumber(value: { toNumber?: () => number } | number | string): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  if (typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return Number(value);
}

type PricedProduct = {
  price: { toNumber?: () => number } | number;
  discountPrice?: { toNumber?: () => number } | number | null;
};

type PricedVariant = {
  price: { toNumber?: () => number } | number;
};

/** Catalog price for a product with no variants. */
export function unitPriceForProduct(product: PricedProduct): number {
  if (product.discountPrice != null) {
    return roundMoney(toNumber(product.discountPrice));
  }
  return roundMoney(toNumber(product.price));
}

/**
 * Variant list price, with product-level sale applied as a ratio
 * (discountPrice / price) so a 20% off product also discounts SKUs.
 */
export function unitPriceForVariant(
  product: PricedProduct,
  variant: PricedVariant,
): number {
  const list = toNumber(product.price);
  const sale =
    product.discountPrice == null ? null : toNumber(product.discountPrice);
  const variantPrice = toNumber(variant.price);

  if (sale != null && list > 0 && sale < list) {
    return roundMoney(variantPrice * (sale / list));
  }

  return roundMoney(variantPrice);
}

export function unitPriceForLine(
  product: PricedProduct,
  variant?: PricedVariant | null,
): number {
  if (variant) {
    return unitPriceForVariant(product, variant);
  }
  return unitPriceForProduct(product);
}
