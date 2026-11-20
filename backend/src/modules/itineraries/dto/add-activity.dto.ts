import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { HH_MM } from '../../../common/database/validators.js';
import type { AddActivityInput } from '../itineraries.types.js';
import { ActivityCostDto } from './activity-cost.dto.js';

/**
 * Request payload for adding an activity to an itinerary day (ITN-10).
 * `name` is required and trimmed; the other fields are optional.
 */
export class AddActivityDto implements AddActivityInput {
  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    example: 'Pyramids of Giza',
    description: 'Activity name (trimmed, required).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    example: 'Guided tour of the pyramids',
    description: 'Optional activity description.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: '09:30',
    pattern: HH_MM.source,
    description: 'Optional time in HH:mm format.',
  })
  @IsOptional()
  @IsString()
  @Matches(HH_MM)
  time?: string;

  @ApiPropertyOptional({
    type: ActivityCostDto,
    description: 'Optional cost in minor units and a supported currency.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ActivityCostDto)
  cost?: ActivityCostDto;
}
