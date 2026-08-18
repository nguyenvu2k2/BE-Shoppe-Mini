import { OrderStatus } from '../../../../generated/prisma/client';
import { IsIn } from 'class-validator';

/** Forward fulfillment only. Cancel uses CancelOrderDto. */
export const FULFILLMENT_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPING,
  OrderStatus.COMPLETED,
] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export class UpdateOrderStatusDto {
  @IsIn(FULFILLMENT_STATUSES)
  status: FulfillmentStatus;
}
