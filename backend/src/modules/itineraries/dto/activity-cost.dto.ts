import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, MinLength } from 'class-validator';
import type { ActivityCostView } from '../itineraries.types.js';

/**
 * ITN-10: an activity's optional cost. Money is an integer in the currency's
 * minor units (data-model.md §1.3); the service checks the currency exists.
 */
export class ActivityCostDto implements ActivityCostView {
  @ApiProperty({
    example: 2000,
    description: 'Non-negative integer amount in the currency’s minor units.',
  })
  @IsInt()
  @Min(0)
  amountMinor!: number;

  @ApiProperty({ example: 'EGP', description: 'Supported currency code.' })
  @IsString()
  @MinLength(1)
  currency!: string;
}
