import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/** One room of the reservation and who sleeps in it. Occupancy is checked by the service. */
export class RoomRequestDto {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a301' })
  @IsMongoId()
  roomId!: string;

  @ApiProperty({
    example: 2,
    minimum: 0,
    description:
      'A room may have only children, if another room has an adult (HTL-16)',
  })
  @IsInt()
  @Min(0)
  adults!: number;

  @ApiProperty({
    type: [Number],
    example: [7],
    description: 'Age of each child, 0-17; empty when there are none',
  })
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(17, { each: true })
  childAges!: number[];
}

/** The body of the hotel hold (HTL-16, HTL-18). The owner comes from the session. */
export class HotelHoldRequestDto {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a300' })
  @IsMongoId()
  hotelId!: string;

  @ApiProperty({ example: '2026-12-10', description: 'YYYY-MM-DD' })
  @Matches(YYYY_MM_DD, { message: 'checkInDate must be a date as YYYY-MM-DD' })
  checkInDate!: string;

  @ApiProperty({
    example: '2026-12-13',
    description: 'YYYY-MM-DD; not charged (nights run up to the day before)',
  })
  @Matches(YYYY_MM_DD, { message: 'checkOutDate must be a date as YYYY-MM-DD' })
  checkOutDate!: string;

  @ApiProperty({ type: [RoomRequestDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoomRequestDto)
  rooms!: RoomRequestDto[];
}
