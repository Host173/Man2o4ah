import { ApiPropertyOptional } from '@nestjs/swagger';
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
import type { UpdateActivityInput } from '../itineraries.types.js';
import { ActivityCostDto } from './activity-cost.dto.js';

/**
 * Partial update payload for an activity (ITN-10).
 * Omitted fields stay unchanged; the service rejects explicit nulls.
 */
export class UpdateActivityDto implements UpdateActivityInput {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 100,
    example: 'Pyramids of Giza',
    description: 'Optional new activity name (trimmed).',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    example: 'Guided tour',
    description: 'Optional new description.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: '09:30',
    pattern: HH_MM.source,
    description: 'Optional new time in HH:mm format.',
  })
  @IsOptional()
  @IsString()
  @Matches(HH_MM)
  time?: string;

  @ApiPropertyOptional({
    type: ActivityCostDto,
    description: 'Optional new cost in minor units and a supported currency.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ActivityCostDto)
  cost?: ActivityCostDto;
}
