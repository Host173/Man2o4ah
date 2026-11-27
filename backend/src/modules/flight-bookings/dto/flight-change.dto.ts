import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import type { FlightChangePreview } from '../flight-bookings.types.js';
import { SegmentDirection } from '../schemas/flight-booking.schema.js';
import {
  QuotePricingResponseDto,
  QuotedSegmentResponseDto,
} from './flight-quote.response.dto.js';

const DIRECTIONS = Object.values(SegmentDirection);

/** `GET /api/flight-bookings/:id/change-preview?direction=outbound&flightId=…` (FLT-27). */
export class FlightChangeQueryDto {
  @ApiProperty({ enum: DIRECTIONS, description: 'The segment to replace' })
  @IsIn(DIRECTIONS)
  direction!: SegmentDirection;

  @ApiProperty({
    example: '6553a1f0c2b4e8a9d0f1b004',
    description: 'The new flight, same route; the same cabin class is used',
  })
  @IsMongoId()
  flightId!: string;
}

/** What a change would cost now (FLT-27). */
export class FlightChangePreviewResponseDto implements FlightChangePreview {
  @ApiProperty({ enum: DIRECTIONS })
  direction!: SegmentDirection;

  @ApiProperty({ type: QuotedSegmentResponseDto })
  segment!: QuotedSegmentResponseDto;

  @ApiProperty({
    type: QuotePricingResponseDto,
    description: 'The booking’s pricing once the change is applied',
  })
  pricing!: QuotePricingResponseDto;

  @ApiProperty({
    example: 10000,
    description:
      'New total − paid total, minor units: > 0 to pay, < 0 refunded in full, 0 nothing moves',
  })
  differenceMinor!: number;
}
