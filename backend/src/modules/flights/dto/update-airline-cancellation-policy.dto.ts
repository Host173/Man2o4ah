import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsObject,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { CancellationTierView } from '../flights.types.js';

class AirlineCancellationTierDto implements CancellationTierView {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    example: 7,
  })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  daysBefore!: number;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 100, example: 80 })
  @IsInt()
  @Min(0)
  @Max(100)
  refundPercent!: number;
}

export class UpdateAirlineCancellationPolicyDto {
  @ApiProperty({
    type: [AirlineCancellationTierDto],
    description:
      'Unique non-negative daysBefore thresholds and integer refund percentages from 0 to 100. An empty array is allowed.',
  })
  @IsArray()
  @ArrayUnique(
    (tier: AirlineCancellationTierDto | null | undefined) => tier?.daysBefore,
    { message: 'tiers must not contain duplicate daysBefore values' },
  )
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => AirlineCancellationTierDto)
  tiers!: CancellationTierView[];
}
