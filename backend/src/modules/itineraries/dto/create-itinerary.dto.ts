import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Request payload for creating an itinerary (ITN-01): a title of 1-100
 * characters, one or more countries from the reference dataset and a start
 * date. The owner always comes from the session, never from the body.
 */
export class CreateItineraryDto {
  @ApiProperty({ minLength: 1, maxLength: 100, example: 'Egypt in a week' })
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @ApiProperty({
    type: [String],
    minItems: 1,
    example: ['EG'],
    description: 'Country codes from the reference dataset; no duplicates.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  countryCodes!: string[];

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2027-04-01',
    description: 'Calendar date, `YYYY-MM-DD`.',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be a YYYY-MM-DD date',
  })
  startDate!: string;
}
