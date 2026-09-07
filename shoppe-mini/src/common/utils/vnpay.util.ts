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
  const secureHash = hmacSha512(hashSecret.trim(), signData);

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
 * PHP `urlencode`: encode everything except A-Za-z0-9-_. and turn space into +.
 * Matches VNPay's official PHP IPN checksum (their Node demo is slightly different).
 */
export function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(
      /[!'()*~]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

/** Parse the raw query string VNPay sent, before Express reshapes keys/values. */
export function parseVnpQueryFromSearch(
  search: string,
): Record<string, string> {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const result: Record<string, string> = {};
  if (!query) return result;

  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? '' : part.slice(eq + 1);
    const key = decodeUriComponentSafe(rawKey.replace(/\+/g, ' '));
    if (!key) continue;
    result[key] = decodeUriComponentSafe(rawVal.replace(/\+/g, ' '));
  }

  return result;
}

export function vnpQueryFromRequest(req: {
  originalUrl?: string;
  url?: string;
  query: Record<string, string | string[] | undefined>;
}): Record<string, string> {
  const path = req.originalUrl || req.url || '';
  const qIndex = path.indexOf('?');
  if (qIndex !== -1) {
    return parseVnpQueryFromSearch(path.slice(qIndex + 1));
  }
  return flattenVnpQuery(req.query);
}

/**
 * Verify IPN/return checksum the same way VNPay signs the callback.
 * PHP demo: only `vnp_*`, drop `vnp_SecureHash`, urlencode key+value, keep empty fields.
 * Node demo: also drops `vnp_SecureHashType`. Accept either so RspCode 97 is not a false reject.
 */
export function verifyVnpSecureHash(
  query: Record<string, string>,
  hashSecret: string,
): boolean {
  const received = query.vnp_SecureHash?.trim().toLowerCase();
  if (!received) return false;

  const secret = hashSecret.trim();
  const candidates = [
    hashVnpParams(query, secret, { dropHashType: false, omitEmpty: false }),
    hashVnpParams(query, secret, { dropHashType: true, omitEmpty: false }),
    hashVnpParams(query, secret, { dropHashType: true, omitEmpty: true }),
  ];

  return candidates.some((expected) => safeEqualHex(received, expected));
}

function hashVnpParams(
  query: Record<string, string>,
  secret: string,
  opts: { dropHashType: boolean; omitEmpty: boolean },
): string {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('vnp_')) continue;
    if (key === 'vnp_SecureHash') continue;
    if (opts.dropHashType && key === 'vnp_SecureHashType') continue;
    if (opts.omitEmpty && value === '') continue;
    params[key] = value;
  }

  const signData = Object.keys(params)
    .sort()
    .map((key) => `${phpUrlEncode(key)}=${phpUrlEncode(params[key])}`)
    .join('&');

  return hmacSha512(secret, signData);
}

function hmacSha512(secret: string, data: string): string {
  return createHmac('sha512', secret)
    .update(Buffer.from(data, 'utf-8'))
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
