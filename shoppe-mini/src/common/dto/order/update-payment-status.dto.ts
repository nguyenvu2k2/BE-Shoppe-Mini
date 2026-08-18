import { PaymentStatus } from '../../../../generated/prisma/client';
import { IsIn } from 'class-validator';

/** Payment transitions only. UNPAID is the initial state at checkout. */
export const PAYMENT_STATUS_UPDATES = [
  PaymentStatus.PAID,
  PaymentStatus.FAILED,
  PaymentStatus.REFUNDED,
] as const;

export type PaymentStatusUpdate = (typeof PAYMENT_STATUS_UPDATES)[number];

export class UpdatePaymentStatusDto {
  @IsIn(PAYMENT_STATUS_UPDATES)
  paymentStatus: PaymentStatusUpdate;
}
