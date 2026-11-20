import { ApiProperty } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { CabinView, FlightManagementView } from '../flights.types.js';

export class CabinResponseDto implements Omit<CabinView, 'id'> {
  @ApiProperty()
  _id!: string;

  @ApiProperty()
  cabinClass!: CabinView['cabinClass'];

  @ApiProperty({ type: 'integer' })
  totalSeats!: number;

  @ApiProperty({ type: 'integer' })
  availableSeats!: number;

  @ApiProperty({ type: 'integer' })
  heldSeats!: number;

  @ApiProperty({ type: 'integer' })
  bookedSeats!: number;

  @ApiProperty({ type: 'integer' })
  priceMinor!: number;

  @ApiProperty({ type: 'integer' })
  freeBags!: number;

  @ApiProperty()
  maxBagWeightKg!: number;
}

export class FlightResponseDto implements Omit<
  FlightManagementView,
  'id' | 'cabins'
> {
  @ApiProperty()
  _id!: string;

  @ApiProperty()
  airlineId!: string;

  @ApiProperty({
    example: 'MS 123',
    minLength: 1,
    maxLength: 10,
    pattern: '^[A-Z0-9 ]+$',
  })
  flightNumber!: string;

  @ApiProperty()
  departureAirportId!: string;

  @ApiProperty()
  arrivalAirportId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  departureAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  arrivalAt!: Date;

  @ApiProperty({ type: String, format: 'date', example: '2027-03-14' })
  departureLocalDate!: string;

  @ApiProperty({ type: 'integer' })
  durationMinutes!: number;

  @ApiProperty()
  status!: FlightManagementView['status'];

  @ApiProperty()
  hasBookings!: boolean;

  @ApiProperty({ type: [CabinResponseDto] })
  cabins!: CabinResponseDto[];

  @ApiProperty({ example: 'America/New_York' })
  departureTimeZone!: string;

  @ApiProperty({ example: 'Africa/Cairo' })
  arrivalTimeZone!: string;

  static fromView(view: FlightManagementView): FlightResponseDto {
    const { id, cabins, ...flight } = view;
    return {
      ...flight,
      _id: id,
      cabins: cabins.map(({ id: cabinId, ...cabin }) => ({
        ...cabin,
        _id: cabinId,
      })),
    };
  }
}

export class PaginatedFlightsResponseDto implements Paginated<FlightResponseDto> {
  @ApiProperty({ type: [FlightResponseDto] })
  items!: FlightResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
