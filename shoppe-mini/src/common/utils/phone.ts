import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { applyDecorators } from '@nestjs/common';

/** VN mobile: 0xxxxxxxxx / 84xxxxxxxxx / +84xxxxxxxxx */
export const VN_PHONE_REGEX = /^(?:\+84|84|0)(?:3|5|7|8|9)\d{8}$/;

export const VN_PHONE_MESSAGE =
  'phone must be a valid Vietnamese mobile number';

export function normalizeVnPhone(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return value.replace(/[\s.-]/g, '');
}

/** Strip spaces/dashes then validate VN mobile format. */
export function IsVnPhone() {
  return applyDecorators(
    Transform(({ value }) => normalizeVnPhone(value)),
    Matches(VN_PHONE_REGEX, { message: VN_PHONE_MESSAGE }),
  );
}
