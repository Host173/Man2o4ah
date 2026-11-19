import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsArray,
  IsIn,
  IsISO8601,
  IsMongoId,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { RoomAvailabilityDto } from './room-availability.dto.js';
import { UpdateRoomDto } from './update-room.dto.js';

/**
 * Body of `PATCH /api/hotels/:id/rooms/:roomId` (endpoints.md): numeric edits
 * (HTL-05) or `isActive: false` to deactivate the room (HTL-06), not both.
 */
export class PatchRoomDto extends UpdateRoomDto {
  @ApiPropertyOptional({
    enum: [false],
    description:
      'HTL-06: send only `isActive: false` to deactivate the room; it cannot be combined with other fields',
  })
  @ValidateIf((input: PatchRoomDto) => input.isActive !== undefined)
  @Equals(false)
  isActive?: false;
}

/**
 * Body of `PATCH /api/hotels/:id/rooms/:roomId/availability` (endpoints.md):
 * `SET_RANGES` (HTL-05) needs only `ranges`; `BLOCK` (HTL-06) needs only
 * `fromDate` and `toDate`; `UNBLOCK` (HTL-06) needs only `blockId`.
 */
export class RoomAvailabilityOperationDto {
  @ApiProperty({ enum: ['SET_RANGES', 'BLOCK', 'UNBLOCK'] })
  @IsIn(['SET_RANGES', 'BLOCK', 'UNBLOCK'])
  op!: 'SET_RANGES' | 'BLOCK' | 'UNBLOCK';

  @ApiPropertyOptional({
    type: [RoomAvailabilityDto],
    description:
      'SET_RANGES only. Replaces all bookable ranges. Overlaps are rejected, adjacent ranges are merged. An empty list clears availability only when no reservation nights from today onward would be excluded.',
  })
  @ValidateIf(
    (input: RoomAvailabilityOperationDto) =>
      input.op === 'SET_RANGES' || input.ranges !== undefined,
  )
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomAvailabilityDto)
  ranges?: RoomAvailabilityDto[];

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-12-10',
    description: 'BLOCK only; first blocked night, inclusive',
  })
  @ValidateIf(
    (input: RoomAvailabilityOperationDto) =>
      input.op === 'BLOCK' || input.fromDate !== undefined,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  fromDate?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-12-12',
    description:
      'BLOCK only; last blocked night, inclusive. Maximum 365 nights including both endpoints.',
  })
  @ValidateIf(
    (input: RoomAvailabilityOperationDto) =>
      input.op === 'BLOCK' || input.toDate !== undefined,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  toDate?: string;

  @ApiPropertyOptional({
    description: 'UNBLOCK only; removes the entire named block',
  })
  @ValidateIf(
    (input: RoomAvailabilityOperationDto) =>
      input.op === 'UNBLOCK' || input.blockId !== undefined,
  )
  @IsMongoId()
  blockId?: string;
}
