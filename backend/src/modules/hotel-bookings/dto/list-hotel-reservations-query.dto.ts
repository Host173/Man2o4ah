import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { HotelReservationGroup } from '../hotel-bookings.types.js';

export class ListHotelReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: Object.values(HotelReservationGroup),
    default: HotelReservationGroup.UPCOMING,
    description: 'Group filter (HTL-20): upcoming, past, or cancelled',
  })
  @IsOptional()
  @IsIn(Object.values(HotelReservationGroup))
  group: HotelReservationGroup = HotelReservationGroup.UPCOMING;
}
