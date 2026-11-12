import { BookingType } from '../../src/common/database/booking-type.js';
import type { RefundRequest } from '../../src/modules/payments/payments.types.js';
import { FakePaymentsService } from './payments.fake.js';

const request: RefundRequest = {
  bookingType: BookingType.FLIGHT,
  bookingId: 'b-1',
  userId: 'u-1',
  amountMinor: 5000,
  currency: 'USD',
  reason: 'user_cancellation',
};

describe('FakePaymentsService', () => {
  it('rejects a refund of 0 with 400 VALIDATION_FAILED', async () => {
    const payments = new FakePaymentsService();
    await expect(
      payments.refund({ ...request, amountMinor: 0 }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_FAILED' },
    });
    expect(payments.refunds).toHaveLength(0);
  });

  it('creates a pending refund with a new ID', async () => {
    const payments = new FakePaymentsService();
    const refund = await payments.refund(request);
    expect(refund).toMatchObject({
      bookingType: 'flight',
      bookingId: 'b-1',
      amountMinor: 5000,
      currency: 'USD',
      reason: 'user_cancellation',
      status: 'pending',
    });
    expect(refund.refundId).toMatch(/^[0-9a-f]{24}$/);
  });

  it('returns the same refund for the same booking', async () => {
    const payments = new FakePaymentsService();
    const first = await payments.refund(request);
    const second = await payments.refund({ ...request, amountMinor: 1 });
    expect(second.refundId).toBe(first.refundId);
    expect(payments.refunds).toHaveLength(1);
  });

  it('keeps flight and hotel bookings with the same ID apart', async () => {
    const payments = new FakePaymentsService();
    const flight = await payments.refund(request);
    const hotel = await payments.refund({
      ...request,
      bookingType: BookingType.HOTEL,
    });
    expect(hotel.refundId).not.toBe(flight.refundId);
  });

  it('getRefund returns null, then the view', async () => {
    const payments = new FakePaymentsService();
    expect(await payments.getRefund(BookingType.FLIGHT, 'b-1')).toBeNull();
    const refund = await payments.refund(request);
    expect(await payments.getRefund(BookingType.FLIGHT, 'b-1')).toEqual(refund);
  });

  it('setStatus moves the refund to another status', async () => {
    const payments = new FakePaymentsService();
    const refund = await payments.refund(request);
    payments.setStatus(refund.refundId, 'refunded');
    expect((await payments.getRefund(BookingType.FLIGHT, 'b-1'))?.status).toBe(
      'refunded',
    );
    expect(() => payments.setStatus('nope', 'failed')).toThrow();
  });
});
