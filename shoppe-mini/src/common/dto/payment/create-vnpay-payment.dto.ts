import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CreateVnpayPaymentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderId: number;
}
