import { Injectable } from '@nestjs/common';
import type { BookingType } from '../../common/database/booking-type.js';
import type { RefundRequest, RefundView } from './payments.types.js';
import { RefundsService } from './refunds.service.js';

@Injectable()
export class PaymentsService {
  constructor(private readonly refunds: RefundsService) {}

  /**
   * Creates the refund (status `pending`) and asks Stripe for it. Call after your transaction commits.
   * One refund per booking: a second call for the same booking returns the existing one.
   * Throws 400 `VALIDATION_FAILED` if `amountMinor <= 0`.
   */
  refund(request: RefundRequest): Promise<RefundView> {
    return this.refunds.refund(request);
  }

  /** The booking's refund, for showing its status (PAY-03). */
  getRefund(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundView | null> {
    return this.refunds.getRefund(bookingType, bookingId);
  }
}
