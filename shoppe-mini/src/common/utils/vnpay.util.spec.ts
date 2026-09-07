import { createHmac } from 'crypto';
import {
  buildVnpPaymentUrl,
  parseVnpQueryFromSearch,
  phpUrlEncode,
  signVnpParams,
  verifyVnpSecureHash,
  vnpQueryFromRequest,
} from './vnpay.util';

const SECRET = 'secretkeyexample123';

const ipnFields = {
  vnp_Amount: '1000000',
  vnp_BankCode: 'NCB',
  vnp_BankTranNo: 'VNP14226112',
  vnp_CardType: 'ATM',
  vnp_OrderInfo: 'Thanh toan don hang ORD-20260907-AB12CD',
  vnp_PayDate: '20231207170112',
  vnp_ResponseCode: '00',
  vnp_TmnCode: 'DEMO1234',
  vnp_TransactionNo: '14226112',
  vnp_TransactionStatus: '00',
  vnp_TxnRef: 'PAY12-20260907170112-ABCDEF',
};

function signedIpn(
  extra: Record<string, string> = {},
  dropHashType = true,
): Record<string, string> {
  const params = { ...ipnFields, ...extra };
  const signSource = { ...params };
  if (dropHashType) {
    delete signSource.vnp_SecureHashType;
  }
  const signData = Object.keys(signSource)
    .sort()
    .map((key) => `${phpUrlEncode(key)}=${phpUrlEncode(signSource[key])}`)
    .join('&');
  const hash = createHmac('sha512', SECRET)
    .update(Buffer.from(signData, 'utf-8'))
    .digest('hex');
  return { ...params, vnp_SecureHash: hash };
}

describe('vnpay.util', () => {
  it('round-trips a payment URL checksum', () => {
    const url = buildVnpPaymentUrl(
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: 'DEMO1234',
        vnp_Locale: 'vn',
        vnp_CurrCode: 'VND',
        vnp_TxnRef: 'PAY1-20260907170112-ABCDEF',
        vnp_OrderInfo: 'Thanh toan don hang ORD-20260907-AB12CD',
        vnp_OrderType: 'other',
        vnp_Amount: 1000000,
        vnp_ReturnUrl: 'https://example.com/payments/vnpay/return',
        vnp_IpAddr: '127.0.0.1',
        vnp_CreateDate: '20260907170112',
        vnp_ExpireDate: '20260907171612',
      },
      SECRET,
    );

    const query = parseVnpQueryFromSearch(url.slice(url.indexOf('?') + 1));
    expect(verifyVnpSecureHash(query, SECRET)).toBe(true);
  });

  it('accepts an IPN payload signed the PHP way (hash type kept)', () => {
    const query = signedIpn({ vnp_SecureHashType: 'HMACSHA512' }, false);
    expect(verifyVnpSecureHash(query, SECRET)).toBe(true);
  });

  it('accepts an IPN payload signed the Node demo way (hash type dropped)', () => {
    const query = signedIpn({ vnp_SecureHashType: 'HMACSHA512' }, true);
    expect(verifyVnpSecureHash(query, SECRET)).toBe(true);
  });

  it('ignores extra non-vnp query params from proxies or Swagger', () => {
    const query = {
      ...signedIpn(),
      fbclid: 'abc',
      env: 'prod',
    };
    expect(verifyVnpSecureHash(query, SECRET)).toBe(true);
  });

  it('keeps empty optional IPN fields in the checksum', () => {
    const query = signedIpn({ vnp_BankTranNo: '' });
    expect(verifyVnpSecureHash(query, SECRET)).toBe(true);
  });

  it('verifies OrderInfo with colon/space the same way VNPay encodes IPN', () => {
    const orderInfo = 'Thanh toan don hang thoi gian: 2023-12-07 17:00:44';
    const query = signedIpn({ vnp_OrderInfo: orderInfo });
    const search = Object.entries(query)
      .map(([key, value]) => `${phpUrlEncode(key)}=${phpUrlEncode(value)}`)
      .join('&');
    const parsed = parseVnpQueryFromSearch(search);
    expect(parsed.vnp_OrderInfo).toBe(orderInfo);
    expect(verifyVnpSecureHash(parsed, SECRET)).toBe(true);
  });

  it('reads the raw request URL instead of Express req.query', () => {
    const query = signedIpn();
    const search = Object.entries(query)
      .map(([key, value]) => `${phpUrlEncode(key)}=${phpUrlEncode(value)}`)
      .join('&');
    const parsed = vnpQueryFromRequest({
      originalUrl: `/payments/vnpay/ipn?${search}`,
      query: { ignored: 'yes' },
    });
    expect(verifyVnpSecureHash(parsed, SECRET)).toBe(true);
  });

  it('rejects a missing or wrong checksum', () => {
    expect(verifyVnpSecureHash({ ...ipnFields }, SECRET)).toBe(false);
    expect(verifyVnpSecureHash(signedIpn(), 'other-secret')).toBe(false);
  });

  it('signs create-payment params without empty fields', () => {
    const { signed, secureHash } = signVnpParams(
      { vnp_Amount: 1000, vnp_BankCode: '', vnp_Command: 'pay' },
      SECRET,
    );
    expect(signed.vnp_BankCode).toBeUndefined();
    expect(secureHash).toHaveLength(128);
  });
});
