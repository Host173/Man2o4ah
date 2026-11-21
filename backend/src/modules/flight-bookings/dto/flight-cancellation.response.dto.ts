import { ApiProperty } from '@nestjs/swagger';
import type { RefundView } from '../../payments/payments.types.js';
import type {
  CancelledFlightBooking,
  FlightRefundPreview,
} from '../flight-bookings.types.js';

export class FlightRefundPreviewResponseDto implements FlightRefundPreview {
  @ApiProperty({ example: 50 })
  percent!: number;

  @ApiProperty({
    example: 20000,
    description: 'Minor units, on the booking total',
  })
  amountMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;
}

type FlightCancellation = CancelledFlightBooking['cancellation'];

class FlightCancellationResponseDto implements FlightCancellation {
  @ApiProperty({ type: String, format: 'date-time' })
  cancelledAt!: Date;

  @ApiProperty({ enum: ['user'] })
  cancelledBy!: 'user';

  @ApiProperty({ example: 50 })
  refundPercent!: number;

  @ApiProperty({ example: 20000 })
  refundAmountMinor!: number;
}

export class FlightRefundResponseDto implements RefundView {
  @ApiProperty()
  refundId!: string;

  @ApiProperty({ enum: ['flight'] })
  bookingType!: 'flight';

  @ApiProperty()
  bookingId!: string;

  @ApiProperty({ example: 20000 })
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

export class CancelledFlightBookingResponseDto implements CancelledFlightBooking {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  _id!: string;

  @ApiProperty({ example: 'FBABC123' })
  reference!: string;

  @ApiProperty({ enum: ['cancelled'] })
  status!: 'cancelled';

  @ApiProperty({ type: FlightCancellationResponseDto })
  cancellation!: CancelledFlightBooking['cancellation'];

  @ApiProperty({
    type: FlightRefundResponseDto,
    nullable: true,
    description: 'Null when no refund is due (0%)',
  })
  refund!: RefundView | null;
}
