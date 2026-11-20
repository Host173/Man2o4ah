import { ApiProperty } from '@nestjs/swagger';
import { BookingType } from '../../../common/database/booking-type.js';
import type { RefundView } from '../payments.types.js';
import { RefundReason, RefundStatus } from '../schemas/refund.schema.js';

/** A refund as its owner sees it: no payment, user or Stripe ids (PAY-03). */
export class RefundResponseDto implements RefundView {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b5' })
  refundId!: string;

  @ApiProperty({ enum: Object.values(BookingType) })
  bookingType!: BookingType;

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  bookingId!: string;

  @ApiProperty({ description: 'Minor units', example: 10000 })
  amountMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ enum: Object.values(RefundReason) })
  reason!: RefundReason;

  @ApiProperty({ enum: Object.values(RefundStatus) })
  status!: RefundStatus;
}
