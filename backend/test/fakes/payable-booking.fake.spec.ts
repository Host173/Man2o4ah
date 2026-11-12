import { BookingType } from '../../src/common/database/booking-type.js';
import type {
  BookingPolicies,
  Payable,
} from '../../src/modules/payments/ports/payable-booking.port.js';
import { FakePayableBooking } from './payable-booking.fake.js';

describe('FakePayableBooking', () => {
  const payable: Payable = {
    amountMinor: 25000,
    currency: 'USD',
    status: 'pending_payment',
    holdExpiresAt: new Date('2026-11-01T10:10:00.000Z'),
  };
  const policies: BookingPolicies = {
    bookingType: 'hotel',
    cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
    checkInTime: '14:00',
    checkOutTime: '12:00',
  };

  function fake() {
    const booking = new FakePayableBooking(BookingType.HOTEL);
    booking.set('b-1', 'u-1', payable, policies);
    return booking;
  }

  it('knows its booking type', () => {
    expect(fake().bookingType).toBe('hotel');
  });

  it('gives the owner the stored amount and policies', async () => {
    const booking = fake();
    expect(await booking.getPayable('b-1', 'u-1')).toEqual(payable);
    expect(await booking.getPolicies('b-1', 'u-1')).toEqual(policies);
  });

  it('answers 404 NOT_FOUND to another user', async () => {
    const booking = fake();
    await expect(booking.getPayable('b-1', 'u-2')).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
    await expect(booking.getPolicies('b-1', 'u-2')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('answers 404 NOT_FOUND for an unknown booking', async () => {
    await expect(fake().getPayable('nope', 'u-1')).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
  });
});
