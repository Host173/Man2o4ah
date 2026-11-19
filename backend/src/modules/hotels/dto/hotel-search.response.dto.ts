import { ApiProperty } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { HotelSearchResult } from '../hotels.types.js';
import { HotelProfileResponseDto } from './hotel-profile.response.dto.js';

export class HotelSearchResponseDto extends HotelProfileResponseDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description:
      'Cheapest qualifying room per night in USD cents, not the combined rooms or total stay price',
  })
  pricePerNightMinor!: number;

  static fromResult(hotel: HotelSearchResult): HotelSearchResponseDto {
    return Object.assign(HotelProfileResponseDto.fromView(hotel), {
      pricePerNightMinor: hotel.pricePerNightMinor,
    });
  }
}

export class PaginatedHotelSearchResponseDto implements Paginated<HotelSearchResponseDto> {
  @ApiProperty({ type: [HotelSearchResponseDto] })
  items!: HotelSearchResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
