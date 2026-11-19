import { PartialType, PickType } from '@nestjs/swagger';
import { CreateRoomDto } from './create-room.dto.js';

export class UpdateRoomDto extends PartialType(
  PickType(CreateRoomDto, [
    'beds',
    'maxOccupancy',
    'pricePerNightMinor',
  ] as const),
  { skipNullProperties: false },
) {}
