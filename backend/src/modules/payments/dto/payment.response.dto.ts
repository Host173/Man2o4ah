import { ApiProperty } from '@nestjs/swagger';
import { BookingType } from '../../../common/database/booking-type.js';
import type { PaymentSession, PaymentView } from '../payments.types.js';
import { PaymentStatus } from '../schemas/payment.schema.js';

/** What the browser needs to pay with Stripe Elements (PAY-01). */
export class PaymentSessionResponseDto implements PaymentSession {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b4' })
  paymentId!: string;

  @ApiProperty({
    description:
      'The PaymentIntent client secret: the only Stripe value the browser sees',
    example: 'pi_3Abc_secret_xyz',
  })
  clientSecret!: string;

  @ApiProperty({ description: 'Minor units', example: 25000 })
  amountMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ description: 'UTC instant; pay before it' })
  holdExpiresAt!: Date;
}

/** A payment's status for its owner (PAY-01). */
export class PaymentResponseDto implements PaymentView {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b4' })
  _id!: string;

  @ApiProperty({ enum: Object.values(BookingType) })
  bookingType!: BookingType;

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  bookingId!: string;

  @ApiProperty({ description: 'Minor units', example: 25000 })
  amountMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ enum: Object.values(PaymentStatus) })
  status!: PaymentStatus;

  @ApiProperty()
  createdAt!: Date;
}

/** The answer Stripe gets from the webhook (PAY-01). */
export class WebhookAckResponseDto {
  @ApiProperty({ example: true })
  received!: true;
}
