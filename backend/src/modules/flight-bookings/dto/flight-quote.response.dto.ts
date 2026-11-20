import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CabinClass } from '../../../common/database/cabin-class.js';
import type {
  FlightQuote,
  QuotedPassenger,
  QuotedSegment,
  QuotedSegmentPolicy,
} from '../flight-bookings.types.js';
import {
  PassengerType,
  SegmentDirection,
  TripType,
} from '../schemas/flight-booking.schema.js';

/*
 * Swagger descriptions of the quote response. Each class `implements` its
 * service type, so the documentation can't drift from what is returned.
 */

class CancellationTierResponseDto {
  @ApiProperty({ example: 7 })
  daysBefore!: number;

  @ApiProperty({ example: 50 })
  refundPercent!: number;
}

export class QuotedSegmentPolicyResponseDto implements QuotedSegmentPolicy {
  @ApiProperty({ type: [CancellationTierResponseDto] })
  cancellationTiers!: CancellationTierResponseDto[];

  @ApiProperty({ example: 1 })
  freeBags!: number;

  @ApiProperty({ example: 23 })
  maxBagWeightKg!: number;

  @ApiProperty({ example: 3000, description: '0 when no extra bags are sold' })
  extraBagPriceMinor!: number;

  @ApiProperty({ example: 2 })
  maxExtraBagsPerPassenger!: number;
}

class QuotedSegmentResponseDto implements QuotedSegment {
  @ApiProperty({ enum: Object.values(SegmentDirection) })
  direction!: SegmentDirection;

  @ApiProperty()
  flightId!: string;

  @ApiProperty()
  cabinId!: string;

  @ApiProperty({ enum: Object.values(CabinClass) })
  cabinClass!: CabinClass;

  @ApiProperty()
  airlineId!: string;

  @ApiProperty({ example: 'Nile Air' })
  airlineName!: string;

  @ApiProperty({ example: 'MS123' })
  flightNumber!: string;

  @ApiProperty({ example: 'CAI' })
  departureAirportId!: string;

  @ApiProperty({ example: 'DXB' })
  arrivalAirportId!: string;

  @ApiProperty({ description: 'UTC instant' })
  departureAt!: Date;

  @ApiProperty({ description: 'UTC instant' })
  arrivalAt!: Date;

  @ApiProperty({ example: 20000, description: 'Fare per seat, minor units' })
  fareMinor!: number;

  @ApiProperty({ type: QuotedSegmentPolicyResponseDto })
  policy!: QuotedSegmentPolicyResponseDto;
}

export class QuotedPassengerResponseDto implements QuotedPassenger {
  @ApiProperty({ enum: Object.values(PassengerType) })
  type!: PassengerType;

  @ApiProperty({ example: 'Aya Amr' })
  fullName!: string;

  @ApiProperty({ example: '1990-01-01' })
  dateOfBirth!: string;

  @ApiProperty({ example: 'A12345678' })
  documentNumber!: string;

  @ApiProperty({ example: 1 })
  extraBagCount!: number;

  @ApiPropertyOptional({ example: 20 })
  extraBagWeightKg?: number;
}

export class QuotePricingResponseDto {
  @ApiProperty({ example: 22000 })
  fareTotalMinor!: number;

  @ApiProperty({ example: 3000 })
  baggageTotalMinor!: number;

  @ApiProperty({ example: 25000 })
  totalMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;
}

/** The booking summary before payment (FLT-19, FLT-21). */
export class FlightQuoteResponseDto implements FlightQuote {
  @ApiProperty({ enum: Object.values(TripType) })
  tripType!: TripType;

  @ApiProperty({ example: 1, description: 'Adults + children' })
  seatCount!: number;

  @ApiProperty({ type: [QuotedSegmentResponseDto] })
  segments!: QuotedSegmentResponseDto[];

  @ApiProperty({ type: [QuotedPassengerResponseDto] })
  passengers!: QuotedPassengerResponseDto[];

  @ApiProperty({ type: QuotePricingResponseDto })
  pricing!: QuotePricingResponseDto;
}
