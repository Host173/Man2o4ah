import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_NOTES_LENGTH } from '../schemas/itinerary.schema.js';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Request payload for adding a day to an itinerary (ITN-05): a city from the
 * reference dataset and optional notes. The day number, its date and its
 * activities are computed or owned by the server, so a client that sends them
 * gets a 400.
 */
export class CreateDayDto {
  @ApiProperty({
    minLength: 1,
    example: 'cairo',
    description: 'City ID from the reference dataset (GEN-12).',
  })
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  cityId!: string;

  @ApiPropertyOptional({
    maxLength: MAX_NOTES_LENGTH,
    example: 'Arrival day',
    description: 'Kept as sent, spaces included.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTES_LENGTH)
  notes?: string;
}
