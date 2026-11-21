import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';
import { CabinClass } from '../../../common/database/cabin-class.js';
import type { AddCabinInput } from '../flights.types.js';
import { MAX_PRICE_MINOR } from '../../../common/money/money.js';

export class AddFlightCabinDto implements AddCabinInput {
  @ApiProperty({ enum: Object.values(CabinClass) })
  @IsEnum(CabinClass)
  cabinClass!: CabinClass;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  totalSeats!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PRICE_MINOR,
    description: 'Price per seat in USD minor units (cents)',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_MINOR)
  priceMinor!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  freeBags!: number;

  @ApiProperty({
    type: 'number',
    minimum: 0,
    exclusiveMinimum: true,
    description: 'Maximum weight in kilograms per bag',
  })
  @IsNumber()
  @IsPositive()
  maxBagWeightKg!: number;
}
