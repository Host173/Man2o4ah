import { ApiProperty } from '@nestjs/swagger';
import type { FlightHold } from '../flight-bookings.types.js';
import { FlightQuoteResponseDto } from './flight-quote.response.dto.js';

/** A seat hold (FLT-22): the quote's summary plus the saved booking. */
export class FlightHoldResponseDto
  extends FlightQuoteResponseDto
  implements FlightHold
{
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  bookingId!: string;

  @ApiProperty({ enum: ['pending_payment'], example: 'pending_payment' })
  status!: 'pending_payment';

  @ApiProperty({
    description: 'UTC instant; the hold ends 10 minutes after it was created',
  })
  holdExpiresAt!: Date;
}
