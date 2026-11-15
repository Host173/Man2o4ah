import { FakeActiveBookingsCheck } from '../../../../test/fakes/active-bookings-check.fake.js';
import { BookingType } from '../../../common/database/booking-type.js';
import type { ActiveBookingsCheck } from './active-bookings-check.port.js';
import { ActiveBookingsCheckRegistry } from './active-bookings-check.registry.js';

function registryWith(flight: string[], hotel: string[]) {
  const registry = new ActiveBookingsCheckRegistry();
  registry.register(new FakeActiveBookingsCheck(BookingType.FLIGHT, flight));
  registry.register(new FakeActiveBookingsCheck(BookingType.HOTEL, hotel));
  return registry;
}

describe('ActiveBookingsCheckRegistry', () => {
  it.each([
    ['no booking type', [], [], false],
    ['only flights', ['u-1'], [], true],
    ['only hotels', [], ['u-1'], true],
    ['both types', ['u-1'], ['u-1'], true],
    ['another user only', ['u-2'], ['u-2'], false],
  ])(
    'answers for a user with upcoming confirmed bookings in %s',
    async (_name, flight, hotel, expected) => {
      await expect(
        registryWith(flight, hotel).hasUpcomingConfirmed('u-1'),
      ).resolves.toBe(expected);
    },
  );

  it('refuses a second check for the same booking type', () => {
    const registry = new ActiveBookingsCheckRegistry();
    registry.register(new FakeActiveBookingsCheck(BookingType.FLIGHT));
    expect(() =>
      registry.register(new FakeActiveBookingsCheck(BookingType.FLIGHT)),
    ).toThrow(/flight.*already registered/);
  });

  it('refuses an unknown booking type', () => {
    const invalid: ActiveBookingsCheck = {
      bookingType: 'train' as unknown as BookingType,
      hasUpcomingConfirmed: () => Promise.resolve(false),
    };
    expect(() => new ActiveBookingsCheckRegistry().register(invalid)).toThrow(
      /train/,
    );
  });

  it('fails instead of answering "no bookings" while a booking type is unregistered', async () => {
    const registry = new ActiveBookingsCheckRegistry();
    registry.register(new FakeActiveBookingsCheck(BookingType.FLIGHT));
    await expect(registry.hasUpcomingConfirmed('u-1')).rejects.toThrow(/hotel/);
  });
});
