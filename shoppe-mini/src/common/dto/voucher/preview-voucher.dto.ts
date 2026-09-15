import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class PreviewVoucherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;

  /** If set, preview only these cart line ids. Omit for the full cart. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  itemIds?: number[];
}
