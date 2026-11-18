import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsArray,
  IsISO8601,
  Matches,
  ValidateNested,
} from 'class-validator';

export class RoomAvailabilityDto {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-12-01',
    description: 'First bookable night, inclusive (YYYY-MM-DD)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  fromDate!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-12-05',
    description: 'Last bookable night, inclusive; not a checkout date',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  toDate!: string;
}

export class SetRoomAvailabilityDto {
  @ApiProperty({ enum: ['SET_RANGES'] })
  @Equals('SET_RANGES')
  op!: 'SET_RANGES';

  @ApiProperty({
    type: [RoomAvailabilityDto],
    description:
      'Replaces all bookable ranges. Overlaps are rejected, adjacent ranges are merged. An empty list clears availability only when no reservation nights from today onward would be excluded.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomAvailabilityDto)
  ranges!: RoomAvailabilityDto[];
}
