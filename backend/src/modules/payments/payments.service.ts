import { Injectable, NotImplementedException } from '@nestjs/common';
import type { BookingType } from '../../common/database/booking-type.js';
import type { RefundRequest, RefundView } from './payments.types.js';

@Injectable()
export class PaymentsService {
  /**
   * Creates the refund (status `pending`) and asks Stripe for it. Call after your transaction commits.
   * One refund per booking: a second call for the same booking returns the existing one.
   * Throws 400 `VALIDATION_FAILED` if `amountMinor <= 0`. Implemented in PAY-03.
   */
  refund(request: RefundRequest): Promise<RefundView> {
    void request;
    throw new NotImplementedException('refund: implemented in PAY-03');
  }

  /** The booking's refund, for showing its status (PAY-03). Implemented in PAY-03. */
  getRefund(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundView | null> {
    void bookingType;
    void bookingId;
    throw new NotImplementedException('getRefund: implemented in PAY-03');
  }
}
