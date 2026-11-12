import { BookingType } from '../../../common/database/booking-type.js';
import { FakePayableBooking } from '../../../../test/fakes/payable-booking.fake.js';
import { PayableBookingRegistry } from './payable-booking.registry.js';

describe('PayableBookingRegistry', () => {
  it('returns the implementer registered for a type', () => {
    const registry = new PayableBookingRegistry();
    const flights = new FakePayableBooking(BookingType.FLIGHT);
    const hotels = new FakePayableBooking(BookingType.HOTEL);
    registry.register(flights);
    registry.register(hotels);
    expect(registry.get(BookingType.FLIGHT)).toBe(flights);
    expect(registry.get(BookingType.HOTEL)).toBe(hotels);
  });

  it('refuses a second implementer for the same type', () => {
    const registry = new PayableBookingRegistry();
    registry.register(new FakePayableBooking(BookingType.FLIGHT));
    expect(() =>
      registry.register(new FakePayableBooking(BookingType.FLIGHT)),
    ).toThrow(/flight.*already registered/);
  });

  it('throws, naming the type, when nothing is registered', () => {
    const registry = new PayableBookingRegistry();
    expect(() => registry.get(BookingType.HOTEL)).toThrow(/hotel/);
  });
});
