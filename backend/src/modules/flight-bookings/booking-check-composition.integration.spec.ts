import { Types } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ActiveBookingsCheckRegistry } from '../accounts/ports/active-bookings-check.registry.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module.js';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const FUTURE = new Date(NOW.getTime() + 86_400_000);

/**
 * ACC-11/ACC-12 end to end: accounts asks one registry, and both booking
 * modules register a check. The answer is true if either type has an upcoming
 * confirmed booking, and false only when neither does.
 */
describe('ActiveBookingsCheckRegistry with both booking modules (integration)', () => {
  let t: TestApp;
  let registry: ActiveBookingsCheckRegistry;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule, HotelBookingsModule],
    });
    registry = t.moduleRef.get(ActiveBookingsCheckRegistry);
  }, HOOK_TIMEOUT);
  beforeEach(async () => {
    await clearCollections(t.connection);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  const flight = (
    userId: string,
    status = 'confirmed',
    firstDepartureAt = FUTURE,
  ) =>
    t.connection.collection('flight_bookings').insertOne({
      userId: new Types.ObjectId(userId),
      status,
      firstDepartureAt,
    });
  const hotel = (userId: string, status = 'confirmed', checkInDate = FUTURE) =>
    t.connection.collection('hotel_reservations').insertOne({
      userId: new Types.ObjectId(userId),
      status,
      checkInDate,
    });
  const has = (userId: string) => registry.hasUpcomingConfirmed(userId);

  it('is false for a user with no bookings of either type', async () => {
    expect(await has(new Types.ObjectId().toHexString())).toBe(false);
  });

  it('is true for an upcoming confirmed flight only', async () => {
    const u = new Types.ObjectId().toHexString();
    await flight(u);
    expect(await has(u)).toBe(true);
  });

  it('is true for an upcoming confirmed hotel only', async () => {
    const u = new Types.ObjectId().toHexString();
    await hotel(u);
    expect(await has(u)).toBe(true);
  });

  it('is true for upcoming confirmed bookings in both types', async () => {
    const u = new Types.ObjectId().toHexString();
    await flight(u);
    await hotel(u);
    expect(await has(u)).toBe(true);
  });

  it('is false for cancelled or past bookings of both types', async () => {
    const u = new Types.ObjectId().toHexString();
    await flight(u, 'cancelled');
    await hotel(u, 'confirmed', new Date(NOW.getTime() - 86_400_000));
    expect(await has(u)).toBe(false);
  });
});
