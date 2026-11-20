import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../../../common/database/booking-type.js';

/** `:type` and `:id` of `/api/bookings/:type/:id/...` (PAY-02). */
export class BookingParamsDto {
  @ApiProperty({ enum: Object.values(BookingType) })
  @IsEnum(BookingType)
  type!: BookingType;

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  @IsMongoId()
  id!: string;
}
