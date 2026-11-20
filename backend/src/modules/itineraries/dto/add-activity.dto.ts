import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsString,
  IsInt,
  IsObject,
  Matches,
  Min,
  MinLength,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { HH_MM } from '../../../common/database/validators.js';
import type { ActivityCostView } from '../itineraries.types.js';

/** ITN-10: an activity's non-negative cost in a supported currency. */
export class ActivityCostDto implements ActivityCostView {
  @ApiProperty({ type: 'integer', minimum: 0, example: 2000 })
  @IsInt()
  @Min(0)
  amountMinor!: number;

  @ApiProperty({ example: 'EGP', pattern: '^[A-Z]{3}$' })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

/**
 * Request payload for adding an activity to an itinerary day (ITN-10).
 * `name` is required and will be trimmed.
 */
export class AddActivityDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    example: 'Pyramids of Giza',
    description: 'Activity name (trimmed, required).',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    example: 'Guided tour of the pyramids',
    description: 'Optional activity description.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: '09:30',
    pattern: HH_MM.source,
    description: 'Optional time in HH:mm format.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(HH_MM)
  time?: string;

  @ApiPropertyOptional({
    type: ActivityCostDto,
    description: 'Optional integer minor-unit amount and supported currency.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => ActivityCostDto)
  cost?: ActivityCostDto;
}
