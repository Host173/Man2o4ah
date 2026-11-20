import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class HotelReservationIdDto {
  @ApiProperty({
    description: 'Reservation ObjectId',
    example: '6553a1f0c2b4e8a9d0f1a2b3',
  })
  @IsMongoId()
  id!: string;
}

/** HTL-21: no room subset, price or owner can be supplied by the client. */
export class CancelHotelReservationDto {}
