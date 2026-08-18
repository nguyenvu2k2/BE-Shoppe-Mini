import { createHmac, timingSafeEqual } from 'crypto';

/**
 * VNPay requires params sorted by key, then each value encodeURIComponent
 * with %20 → +. The HMAC is SHA512 over that query string (not re-encoded).
 * Official demo: https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
 */
export function sortVnpParams(
  params: Record<string, string | number>,
): Record<string, string> {
  const sorted: Record<string, string> = {};
  const keys = Object.keys(params)
    .filter((key) => params[key] !== '' && params[key] != null)
    .sort();

  for (const key of keys) {
    sorted[key] = encodeURIComponent(String(params[key])).replace(/%20/g, '+');
  }

  return sorted;
}

export function buildVnpSignData(sorted: Record<string, string>): string {
  return Object.entries(sorted)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

export function signVnpParams(
  params: Record<string, string | number>,
  hashSecret: string,
): { signed: Record<string, string>; secureHash: string } {
  const sorted = sortVnpParams(params);
  const signData = buildVnpSignData(sorted);
  const secureHash = createHmac('sha512', hashSecret)
    .update(Buffer.from(signData, 'utf-8'))
    .digest('hex');

  return { signed: sorted, secureHash };
}

export function buildVnpPaymentUrl(
  payUrl: string,
  params: Record<string, string | number>,
  hashSecret: string,
): string {
  const { signed, secureHash } = signVnpParams(params, hashSecret);
  const query = buildVnpSignData(signed);
  return `${payUrl}?${query}&vnp_SecureHash=${secureHash}`;
}

/** yyyyMMddHHmmss in Asia/Ho_Chi_Minh — VNPay expects GMT+7. */
export function formatVnpDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

export function getClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = (raw?.split(',')[0] ?? req.socket?.remoteAddress ?? '127.0.0.1')
    .trim()
    .replace(/^::ffff:/, '');

  return ip === '::1' ? '127.0.0.1' : ip;
}

/** VNPay amount is VND × 100, integer. */
export function toVnpAmount(vnd: number): number {
  return Math.round(vnd * 100);
}

export function flattenVnpQuery(
  query: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    flat[key] = Array.isArray(value) ? (value[0] ?? '') : value;
  }
  return flat;
}

/**
 * Verify IPN/return checksum the same way the URL was signed.
 * Compare lowercase hex with timingSafeEqual to avoid leak-by-timing.
 */
export function verifyVnpSecureHash(
  query: Record<string, string>,
  hashSecret: string,
): boolean {
  const received = query.vnp_SecureHash?.toLowerCase();
  if (!received) return false;

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue;
    params[key] = value;
  }

  const expected = signVnpParams(params, hashSecret).secureHash.toLowerCase();
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
