import type { BookingType } from '../../common/database/booking-type.js';
import type { RefundReason, RefundStatus } from './schemas/refund.schema.js';

/** The input of `PaymentsService.refund` (PAY-03). */
export interface RefundRequest {
  bookingType: BookingType;
  bookingId: string;
  userId: string;
  /** > 0 (a 0% refund is never requested, PAY-03) */
  amountMinor: number;
  currency: string;
  reason: RefundReason;
}

/** A refund as other modules see it (PAY-03). */
export interface RefundView {
  refundId: string;
  bookingType: BookingType;
  bookingId: string;
  amountMinor: number;
  currency: string;
  reason: RefundReason;
  status: RefundStatus;
}
