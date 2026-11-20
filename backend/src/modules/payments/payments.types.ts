import type { BookingType } from '../../common/database/booking-type.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
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

/** What the browser needs to pay a booking: the PaymentIntent's client secret and the hold end (PAY-01). */
export interface PaymentSession {
  paymentId: string;
  clientSecret: string;
  amountMinor: number;
  currency: string;
  holdExpiresAt: Date;
}

/** A payment as its owner sees it: no Stripe IDs, no secrets (PAY-01). */
export interface PaymentView {
  _id: string;
  bookingType: BookingType;
  bookingId: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
}
