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
 * Request payload for adding an activity to an itinerary day (ITN-10).
 * `name` is required and will be trimmed.
 */
export class AddActivityDto {
  @ApiProperty({
    minLength: 1,
    example: 'Pyramids of Giza',
    description: 'Activity name (trimmed, required).',
  })
  @IsString()
  @IsString()
  @MinLength(1)
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
    description: 'Optional time in HH:mm format.',
  })
  @IsOptional()
  @IsString()
  time?: string;

  @ApiPropertyOptional({
    example: 2000,
    description: 'Optional cost in minor units (e.g. 2000 = 20.00 EGP).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;
}
