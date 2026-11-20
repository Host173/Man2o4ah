import { ApiProperty } from '@nestjs/swagger';
import { BookingType } from '../../../common/database/booking-type.js';
import type { PolicyAcceptanceView } from '../payments.types.js';

/** One cancellation tier: the refund percent that applies from `daysBefore` days out. */
export class PolicyTierResponseDto {
  @ApiProperty({ example: 7 })
  daysBefore!: number;

  @ApiProperty({ example: 100 })
  refundPercent!: number;
}

/** The policies of one flight segment of a booking (PAY-02). */
export class FlightSegmentPoliciesResponseDto {
  @ApiProperty({ enum: ['outbound', 'return'], example: 'outbound' })
  direction!: 'outbound' | 'return';

  @ApiProperty({ example: 'MS777' })
  flightNumber!: string;

  @ApiProperty({ type: () => PolicyTierResponseDto, isArray: true })
  cancellationTiers!: PolicyTierResponseDto[];

  @ApiProperty({ example: 1 })
  freeBags!: number;

  @ApiProperty({ example: 23 })
  maxBagWeightKg!: number;

  @ApiProperty({ description: 'Minor units', example: 5000 })
  extraBagPriceMinor!: number;

  @ApiProperty({ example: 2 })
  maxExtraBagsPerPassenger!: number;
}

/** A flight booking's policies and whether they were accepted (PAY-02). */
export class FlightPoliciesResponseDto {
  @ApiProperty({ enum: ['flight'], example: 'flight' })
  bookingType!: 'flight';

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  bookingId!: string;

  @ApiProperty({ type: () => FlightSegmentPoliciesResponseDto, isArray: true })
  segments!: FlightSegmentPoliciesResponseDto[];

  @ApiProperty()
  accepted!: boolean;

  @ApiProperty({ type: Date, nullable: true })
  acceptedAt!: Date | null;
}

/** A hotel reservation's policies and whether they were accepted (PAY-02). */
export class HotelPoliciesResponseDto {
  @ApiProperty({ enum: ['hotel'], example: 'hotel' })
  bookingType!: 'hotel';

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  bookingId!: string;

  @ApiProperty({ type: () => PolicyTierResponseDto, isArray: true })
  cancellationTiers!: PolicyTierResponseDto[];

  @ApiProperty({ example: '14:00' })
  checkInTime!: string;

  @ApiProperty({ example: '11:00' })
  checkOutTime!: string;

  @ApiProperty()
  accepted!: boolean;

  @ApiProperty({ type: Date, nullable: true })
  acceptedAt!: Date | null;
}

/** The stored acceptance; repeating the request returns the first one (PAY-02). */
export class PolicyAcceptanceResponseDto implements PolicyAcceptanceView {
  @ApiProperty({ enum: Object.values(BookingType) })
  bookingType!: BookingType;

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  bookingId!: string;

  @ApiProperty({ enum: [true], example: true })
  accepted!: true;

  @ApiProperty({ description: 'UTC instant, set by the server' })
  acceptedAt!: Date;
}
