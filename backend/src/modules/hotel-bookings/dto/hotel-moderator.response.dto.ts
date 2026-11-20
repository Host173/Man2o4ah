import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HotelReservationStatus } from '../schemas/hotel-reservation.schema.js';

export class ReservationGuestDto {
  @ApiProperty()
  _id!: string;

  @ApiPropertyOptional({
    description: 'Current account name; absent if the account no longer exists',
  })
  name?: string;
}

/** HTL-22: only the guest, dates, status and reference; no account credentials or payment data. */
export class ModeratorReservationDto {
  @ApiProperty()
  _id!: string;

  @ApiPropertyOptional({ description: 'Assigned on confirmation (HTL-17)' })
  reference?: string;

  @ApiProperty({ type: ReservationGuestDto })
  guest!: ReservationGuestDto;

  @ApiProperty({ example: '2027-03-10' })
  checkInDate!: string;

  @ApiProperty({ example: '2027-03-12' })
  checkOutDate!: string;

  @ApiProperty({ enum: Object.values(HotelReservationStatus) })
  status!: HotelReservationStatus;
}

export class RoomNightStatusDto {
  @ApiProperty({ example: '2027-03-10' })
  date!: string;

  @ApiProperty({ enum: ['available', 'booked', 'blocked'] })
  status!: 'available' | 'booked' | 'blocked';

  @ApiPropertyOptional({
    description: 'Present for a booked night, including an unpaid hold',
  })
  reservationId?: string;

  @ApiPropertyOptional({
    description:
      'Present for a booked night after confirmation; unpaid holds have no reference yet',
  })
  reference?: string;

  @ApiPropertyOptional({
    enum: ['blocked_range', 'inactive_room', 'outside_availability'],
  })
  reason?: 'blocked_range' | 'inactive_room' | 'outside_availability';
}

/** HTL-08: every night from `from` through `to`, with non-bookable nights shown as Blocked and a reason. */
export class ModeratorRoomStatusDto {
  @ApiProperty()
  _id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: [RoomNightStatusDto] })
  nights!: RoomNightStatusDto[];
}

class ModeratorPageDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class ModeratorReservationsPageDto extends ModeratorPageDto {
  @ApiProperty({ type: [ModeratorReservationDto] })
  items!: ModeratorReservationDto[];
}

export class ModeratorAvailabilityPageDto extends ModeratorPageDto {
  @ApiProperty({ type: [ModeratorRoomStatusDto] })
  items!: ModeratorRoomStatusDto[];
}
