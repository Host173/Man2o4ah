import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../../../common/database/booking-type.js';

/** The booking to pay (PAY-01). The amount comes from the booking, never from the client. */
export class CreatePaymentDto {
  @ApiProperty({
    enum: Object.values(BookingType),
    example: BookingType.FLIGHT,
  })
  @IsEnum(BookingType)
  bookingType!: BookingType;

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  @IsMongoId()
  bookingId!: string;
}
