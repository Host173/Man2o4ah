import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CabinClass } from '../../../common/database/cabin-class.js';
import { CancelledBy } from '../../../common/database/cancellation.schema.js';
import type { Cancellation } from '../../../common/database/cancellation.schema.js';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type {
  MyFlightBooking,
  MyFlightBookingSegment,
  MyFlightBookingSegmentSummary,
  MyFlightBookingSummary,
} from '../flight-bookings.types.js';
import {
  FlightBookingStatus,
  PassengerType,
  SegmentDirection,
  TripType,
} from '../schemas/flight-booking.schema.js';
import {
  QuotePricingResponseDto,
  QuotedPassengerResponseDto,
  QuotedSegmentPolicyResponseDto,
} from './flight-quote.response.dto.js';

/*
 * Swagger descriptions of the FLT-25 responses. Each class `implements` its
 * service type, so the documentation can't drift from what is returned.
 */

class MyFlightBookingSegmentSummaryResponseDto implements MyFlightBookingSegmentSummary {
  @ApiProperty({ enum: Object.values(SegmentDirection) })
  direction!: SegmentDirection;

  @ApiProperty({ example: 'MS100' })
  flightNumber!: string;

  @ApiProperty({ example: 'CAI' })
  departureAirportId!: string;

  @ApiProperty({ example: 'DXB' })
  arrivalAirportId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'UTC instant',
  })
  departureAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'UTC instant',
  })
  arrivalAt!: Date;

  @ApiProperty({ enum: Object.values(CabinClass) })
  cabinClass!: CabinClass;
}

class MyFlightBookingPassengerSummaryResponseDto {
  @ApiProperty({ enum: Object.values(PassengerType) })
  type!: PassengerType;

  @ApiProperty({ example: 'Aya Amr' })
  fullName!: string;
}

class MyFlightBookingPricingSummaryResponseDto {
  @ApiProperty({ example: 25000 })
  totalMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;
}

/** One row of the "my bookings" list (FLT-25). */
export class MyFlightBookingSummaryResponseDto implements MyFlightBookingSummary {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  _id!: string;

  @ApiPropertyOptional({
    example: 'FBABC123',
    description: 'Set only once the booking is confirmed',
  })
  reference?: string;

  @ApiProperty({ enum: Object.values(FlightBookingStatus) })
  status!: FlightBookingStatus;

  @ApiProperty({ enum: Object.values(TripType) })
  tripType!: TripType;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Outbound departure, UTC',
  })
  firstDepartureAt!: Date;

  @ApiProperty({ type: [MyFlightBookingSegmentSummaryResponseDto] })
  segments!: MyFlightBookingSegmentSummaryResponseDto[];

  @ApiProperty({ type: [MyFlightBookingPassengerSummaryResponseDto] })
  passengers!: MyFlightBookingPassengerSummaryResponseDto[];

  @ApiProperty({ example: 1, description: 'Adults + children' })
  seatCount!: number;

  @ApiProperty({ type: MyFlightBookingPricingSummaryResponseDto })
  pricing!: MyFlightBookingPricingSummaryResponseDto;
}

/** One page of the "my bookings" list (FLT-25). */
export class PaginatedMyFlightBookingsResponseDto implements Paginated<MyFlightBookingSummaryResponseDto> {
  @ApiProperty({ type: [MyFlightBookingSummaryResponseDto] })
  items!: MyFlightBookingSummaryResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

class MyFlightBookingSegmentResponseDto
  extends MyFlightBookingSegmentSummaryResponseDto
  implements MyFlightBookingSegment
{
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1e202' })
  flightId!: string;

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1e201' })
  airlineId!: string;

  @ApiProperty({
    example: 20000,
    description: 'Fare per seat at hold time, minor units',
  })
  fareMinor!: number;

  @ApiProperty({ type: QuotedSegmentPolicyResponseDto })
  policy!: QuotedSegmentPolicyResponseDto;
}

class CancellationResponseDto implements Cancellation {
  @ApiProperty({ type: String, format: 'date-time' })
  cancelledAt!: Date;

  @ApiProperty({ enum: Object.values(CancelledBy) })
  cancelledBy!: CancelledBy;

  @ApiProperty({ example: 50 })
  refundPercent!: number;

  @ApiProperty({ example: 12500 })
  refundAmountMinor!: number;
}

/** The full booking for its owner (FLT-25 details). */
export class MyFlightBookingResponseDto implements MyFlightBooking {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  _id!: string;

  @ApiPropertyOptional({
    example: 'FBABC123',
    description: 'Set only once the booking is confirmed',
  })
  reference?: string;

  @ApiProperty({ enum: Object.values(FlightBookingStatus) })
  status!: FlightBookingStatus;

  @ApiProperty({ enum: Object.values(TripType) })
  tripType!: TripType;

  @ApiProperty({ type: [MyFlightBookingSegmentResponseDto] })
  segments!: MyFlightBookingSegmentResponseDto[];

  @ApiProperty({ type: [QuotedPassengerResponseDto] })
  passengers!: QuotedPassengerResponseDto[];

  @ApiProperty({ example: 1, description: 'Adults + children' })
  seatCount!: number;

  @ApiProperty({ type: QuotePricingResponseDto })
  pricing!: QuotePricingResponseDto;

  @ApiProperty({ type: String, format: 'date-time' })
  holdExpiresAt!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  confirmedAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  expiredAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  completedAt?: Date;

  @ApiPropertyOptional({ type: CancellationResponseDto })
  cancellation?: CancellationResponseDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
