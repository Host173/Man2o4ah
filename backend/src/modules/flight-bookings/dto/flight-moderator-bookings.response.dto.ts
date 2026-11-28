import { ApiProperty } from '@nestjs/swagger';
import { CabinClass } from '../../../common/database/cabin-class.js';
import type {
  FlightCabinAvailabilityView,
  FlightModeratorBookingView,
  FlightModeratorBookingsPage,
} from '../flight-bookings.types.js';
import { FlightBookingStatus } from '../schemas/flight-booking.schema.js';

export class FlightModeratorBookingResponseDto implements FlightModeratorBookingView {
  @ApiProperty({ example: 'FBABC123' })
  reference!: string;

  @ApiProperty({ type: [String], example: ['Aya Amr', 'Jana Test'] })
  passengerNames!: string[];

  @ApiProperty({ enum: Object.values(CabinClass) })
  cabinClass!: CabinClass;

  @ApiProperty({
    example: 2,
    description: 'Number of adult and child seats in the booking',
  })
  seatCount!: number;

  @ApiProperty({
    enum: [FlightBookingStatus.CONFIRMED, FlightBookingStatus.CANCELLED],
  })
  status!: FlightBookingStatus;
}

export class FlightCabinAvailabilityResponseDto implements FlightCabinAvailabilityView {
  @ApiProperty({ enum: Object.values(CabinClass) })
  cabinClass!: CabinClass;

  @ApiProperty({ example: 48, description: 'Seats currently available' })
  availableSeats!: number;
}

export class FlightModeratorBookingsPageResponseDto implements FlightModeratorBookingsPage {
  @ApiProperty({ type: [FlightModeratorBookingResponseDto] })
  items!: FlightModeratorBookingResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;

  @ApiProperty({ type: [FlightCabinAvailabilityResponseDto] })
  seatsRemainingPerCabin!: FlightCabinAvailabilityResponseDto[];
}
