import { ApiProperty, PickType } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { AvailableRoomView } from '../hotels.types.js';
import { RoomResponseDto } from './room.response.dto.js';

export class AvailableRoomResponseDto extends PickType(RoomResponseDto, [
  '_id',
  'hotelId',
  'name',
  'type',
  'beds',
  'maxOccupancy',
  'pricePerNightMinor',
] as const) {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description:
      'Nightly price times the number of nights, in USD cents. Viewing a room does not hold it or lock its price.',
  })
  totalMinor!: number;

  static fromView(room: AvailableRoomView): AvailableRoomResponseDto {
    const { id, ...fields } = room;
    return { _id: id, ...fields };
  }
}

export class PaginatedAvailableRoomsResponseDto implements Paginated<AvailableRoomResponseDto> {
  @ApiProperty({ type: [AvailableRoomResponseDto] })
  items!: AvailableRoomResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
