import { BookingType } from '../../src/common/database/booking-type.js';
import { FakeActiveBookingsCheck } from './active-bookings-check.fake.js';

describe('FakeActiveBookingsCheck', () => {
  it('answers true only for seeded users', async () => {
    const check = new FakeActiveBookingsCheck(BookingType.HOTEL, ['u-1']);
    expect(check.bookingType).toBe('hotel');
    await expect(check.hasUpcomingConfirmed('u-1')).resolves.toBe(true);
    await expect(check.hasUpcomingConfirmed('u-2')).resolves.toBe(false);
  });

  it('can be changed with set()', async () => {
    const check = new FakeActiveBookingsCheck(BookingType.FLIGHT);
    check.set('u-1', true);
    await expect(check.hasUpcomingConfirmed('u-1')).resolves.toBe(true);
    check.set('u-1', false);
    await expect(check.hasUpcomingConfirmed('u-1')).resolves.toBe(false);
  });
});
