import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import type { BaggagePolicyView } from '../flights.types.js';

export class UpdateAirlineBaggagePolicyDto implements BaggagePolicyView {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    example: 2500,
    description:
      'Price per extra bag in USD minor units; null is allowed when maximum is zero',
  })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  extraBagPriceMinor!: number | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    example: 2,
  })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxExtraBagsPerPassenger!: number;
}
