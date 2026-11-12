import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { BookingType } from '../../src/common/database/booking-type.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type { PaymentsService } from '../../src/modules/payments/payments.service.js';
import type {
  RefundRequest,
  RefundView,
} from '../../src/modules/payments/payments.types.js';
import type { RefundStatus } from '../../src/modules/payments/schemas/refund.schema.js';
import type { PublicApi } from './public-api.js';

/** A working `PaymentsService` for other modules' tests: one pending refund per booking, kept in memory. */
export class FakePaymentsService implements PublicApi<PaymentsService> {
  readonly refunds: RefundView[] = [];

  // async: a validation failure rejects the promise, like the real service.
  async refund(request: RefundRequest): Promise<RefundView> {
    if (!(request.amountMinor > 0)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid refund',
        details: [{ field: 'amountMinor', message: 'must be greater than 0' }],
      });
    }
    const existing = this.find(request.bookingType, request.bookingId);
    if (existing) return existing;
    const view: RefundView = {
      refundId: new Types.ObjectId().toHexString(),
      bookingType: request.bookingType,
      bookingId: request.bookingId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      reason: request.reason,
      status: 'pending',
    };
    this.refunds.push(view);
    return view;
  }

  getRefund(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundView | null> {
    return Promise.resolve(this.find(bookingType, bookingId) ?? null);
  }

  /** Moves a refund to another status, as the Stripe webhook would. */
  setStatus(refundId: string, status: RefundStatus): void {
    const view = this.refunds.find((refund) => refund.refundId === refundId);
    if (!view) throw new Error(`No refund ${refundId}`);
    view.status = status;
  }

  private find(
    bookingType: BookingType,
    bookingId: string,
  ): RefundView | undefined {
    return this.refunds.find(
      (refund) =>
        refund.bookingType === bookingType && refund.bookingId === bookingId,
    );
  }
}
