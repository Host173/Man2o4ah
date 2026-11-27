import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import type {
  ChangedFlightBooking,
  FlightChangePreview,
} from '../flight-bookings.types.js';
import { SegmentDirection } from '../schemas/flight-booking.schema.js';
import { FlightRefundResponseDto } from './flight-cancellation.response.dto.js';
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

/** `PATCH /api/flight-bookings/:id/change-flight` body: the same two fields as the preview (FLT-27). */
export class FlightChangeRequestDto extends FlightChangeQueryDto {}

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

/** A requested change (FLT-27): applied at once, or waiting for payment. */
export class ChangedFlightBookingResponseDto
  extends FlightChangePreviewResponseDto
  implements ChangedFlightBooking
{
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  bookingId!: string;

  @ApiProperty({ example: 'FBABC123' })
  reference!: string;

  @ApiProperty({ enum: ['confirmed'] })
  status!: 'confirmed';

  @ApiProperty({
    description:
      'True when applied now (same or lower fare); false when it waits for payment',
  })
  applied!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the held seats are released if unpaid; null when applied',
  })
  holdExpiresAt!: Date | null;

  @ApiProperty({ description: 'The change’s id in the booking’s history' })
  changeId!: string;

  @ApiProperty({
    type: FlightRefundResponseDto,
    nullable: true,
    description:
      'The lower fare refunded in full; null when the fare is the same',
  })
  refund!: FlightRefundResponseDto | null;
}
