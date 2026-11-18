import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';

/**
 * Partial update payload for an activity (ITN-10).
 * Omitted fields stay unchanged; `null` is rejected.
 */
export class UpdateActivityDto {
  @ApiPropertyOptional({
    minLength: 1,
    example: 'Pyramids of Giza',
    description: 'Optional new activity name (trimmed).',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    example: 'Guided tour of the pyramids',
    description: 'Optional new description.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: '09:30',
    description: 'Optional new time in HH:mm format.',
  })
  @IsOptional()
  @IsString()
  time?: string;

  @ApiPropertyOptional({
    example: 2000,
    description: 'Optional new cost in minor units.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;
}
