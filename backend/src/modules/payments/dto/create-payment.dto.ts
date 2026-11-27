import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
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

  @ApiPropertyOptional({
    example: '6553a1f0c2b4e8a9d0f1a2b9',
    description:
      'FLT-27: pay the flight change waiting for payment (the changeId from PATCH change-flight) instead of the booking',
  })
  @IsOptional()
  @IsMongoId()
  changeId?: string;
}
