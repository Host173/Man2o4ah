import { ApiProperty } from '@nestjs/swagger';
import type {
  CancelledHotelReservation,
  HotelRefundPreview,
} from '../hotel-bookings.types.js';
import type { RefundView } from '../../payments/payments.types.js';

export class HotelRefundPreviewResponseDto implements HotelRefundPreview {
  @ApiProperty({ example: 50 })
  percent!: number;

  @ApiProperty({ example: 5000, description: 'Minor units, on the full total' })
  amountMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;
}

type HotelCancellation = CancelledHotelReservation['cancellation'];

class HotelCancellationResponseDto implements HotelCancellation {
  @ApiProperty({ type: String, format: 'date-time' })
  cancelledAt!: Date;

  @ApiProperty({ enum: ['user'] })
  cancelledBy!: 'user';

  @ApiProperty({ example: 50 })
  refundPercent!: number;

  @ApiProperty({ example: 5000 })
  refundAmountMinor!: number;
}

class HotelRefundResponseDto implements RefundView {
  @ApiProperty()
  refundId!: string;

  @ApiProperty({ enum: ['hotel'] })
  bookingType!: 'hotel';

  @ApiProperty()
  bookingId!: string;

  @ApiProperty({ example: 5000 })
  amountMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({
    enum: ['user_cancellation', 'provider_cancellation', 'late_payment'],
  })
  reason!: RefundView['reason'];

  @ApiProperty({ enum: ['pending', 'refunded', 'failed'] })
  status!: RefundView['status'];
}

export class CancelledHotelReservationResponseDto implements CancelledHotelReservation {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  _id!: string;

  @ApiProperty({ example: 'HRABCDEF' })
  reference!: string;

  @ApiProperty({ enum: ['cancelled'] })
  status!: 'cancelled';

  @ApiProperty({ type: HotelCancellationResponseDto })
  cancellation!: CancelledHotelReservation['cancellation'];

  @ApiProperty({ type: HotelRefundResponseDto, nullable: true })
  refund!: RefundView | null;
}
