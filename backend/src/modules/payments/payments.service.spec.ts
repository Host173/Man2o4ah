import { NotImplementedException } from '@nestjs/common';
import { BookingType } from '../../common/database/booking-type.js';
import { PaymentsService } from './payments.service.js';
import { RefundReason } from './schemas/refund.schema.js';

describe('PaymentsService (stub)', () => {
  const service = new PaymentsService();

  it('refund is not implemented yet (PAY-03)', () => {
    expect(() =>
      service.refund({
        bookingType: BookingType.FLIGHT,
        bookingId: 'b-1',
        userId: 'u-1',
        amountMinor: 100,
        currency: 'USD',
        reason: RefundReason.USER_CANCELLATION,
      }),
    ).toThrow(NotImplementedException);
  });

  it('getRefund is not implemented yet (PAY-03)', () => {
    expect(() => service.getRefund(BookingType.HOTEL, 'b-1')).toThrow(
      NotImplementedException,
    );
  });
});
