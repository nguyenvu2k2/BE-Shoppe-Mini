import { PaymentMethod } from '../../../../generated/prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  addressId: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  /** If set, only these cart line ids are checked out. Omit to checkout the full cart. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  itemIds?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
