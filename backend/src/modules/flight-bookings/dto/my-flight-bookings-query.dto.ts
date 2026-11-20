import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { BOOKING_GROUPS } from '../booking-groups.js';
import type { BookingGroup } from '../booking-groups.js';

/** `GET /api/flight-bookings?group=upcoming&page=1&limit=10` (FLT-25). */
export class MyFlightBookingsQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: BOOKING_GROUPS, example: 'upcoming' })
  @IsIn(BOOKING_GROUPS)
  group!: BookingGroup;
}
