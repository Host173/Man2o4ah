import { ApiProperty } from '@nestjs/swagger';
import { IsArray } from 'class-validator';

/**
 * Request payload for moving a day (ITN-08). `dayIds` must list every current
 * day ID exactly once, in the new order; days added by an overlapping request
 * after the client read the itinerary may be left out and stay at the end. The
 * service checks the list, because only it knows which days the itinerary
 * currently has; a payload that is not such a list fails with 400 on `dayIds`.
 */
export class ReorderDaysDto {
  @ApiProperty({
    type: [String],
    example: [
      '6736f0b2c5a1b2c3d4e5f604',
      '6736f0b2c5a1b2c3d4e5f608',
      '6736f0b2c5a1b2c3d4e5f609',
    ],
    description:
      'Every current day ID, exactly once, in the new order. Days appended after the client loaded the itinerary may be omitted; they stay at the end.',
  })
  @IsArray()
  dayIds!: string[];
}
