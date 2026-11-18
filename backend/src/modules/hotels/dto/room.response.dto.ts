import { ApiProperty } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { RoomView } from '../hotels.types.js';

class RoomAvailabilityResponseDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-12-01' })
  fromDate!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-12-31' })
  toDate!: string;
}

export class RoomResponseDto implements Omit<RoomView, 'id' | 'availability'> {
  @ApiProperty()
  _id!: string;

  @ApiProperty()
  hotelId!: string;

  @ApiProperty({
    description:
      'New room names are trimmed and lowercase; legacy names retain their stored capitalization',
  })
  name!: string;

  @ApiProperty({ minLength: 1, maxLength: 50 })
  type!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  beds!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  maxOccupancy!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pricePerNightMinor!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: [RoomAvailabilityResponseDto] })
  availability!: RoomAvailabilityResponseDto[];

  @ApiProperty()
  hasEverBeenReserved!: boolean;

  static fromView(room: RoomView): RoomResponseDto {
    const { id, availability, ...fields } = room;
    return {
      _id: id,
      ...fields,
      availability: availability.map(({ fromDate, toDate }) => ({
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
      })),
    };
  }
}

export class PaginatedRoomsResponseDto implements Paginated<RoomResponseDto> {
  @ApiProperty({ type: [RoomResponseDto] })
  items!: RoomResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
