import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingType } from '../../../common/database/booking-type.js';
import type { Paginated } from '../../../common/pagination/paginated.js';
import {
  ADMIN_BOOKING_STATUSES,
  type AdminBookingStatus,
} from '../admin.types.js';

/** Swagger response model for one row in the admin booking list (`ACC-17`, `CTR-04`). */
export class AdminBookingResponseDto {
  @ApiProperty({
    enum: Object.values(BookingType),
    example: BookingType.FLIGHT,
  })
  bookingType!: BookingType;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f610' })
  bookingId!: string;

  @ApiPropertyOptional({
    example: 'FBABC123',
    description: 'Set only once the booking is confirmed',
  })
  reference?: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f603' })
  userId!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f620' })
  providerId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-12-01T08:00:00.000Z',
  })
  startAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-12-08T08:00:00.000Z',
  })
  endAt!: Date;

  @ApiProperty({ example: 25000 })
  totalMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ enum: ADMIN_BOOKING_STATUSES, example: 'confirmed' })
  status!: AdminBookingStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T12:00:00.000Z',
  })
  createdAt!: Date;
}

/** Swagger response model for the paginated admin booking list (`ACC-17`). */
export class PaginatedAdminBookingsResponseDto implements Paginated<AdminBookingResponseDto> {
  @ApiProperty({ type: [AdminBookingResponseDto] })
  items!: AdminBookingResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
