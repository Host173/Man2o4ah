import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ClientSession, Model } from 'mongoose';
import { BookingType } from '../../src/common/database/booking-type.js';
import { toDateOnly } from '../../src/common/dates/date-only.js';
import { AppEvents } from '../../src/common/events/app-events.service.js';
import { Events } from '../../src/common/events/events.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { ActiveBookingsCheckRegistry } from '../../src/modules/accounts/ports/active-bookings-check.registry.js';
import {
  User,
  UserStatus,
} from '../../src/modules/accounts/schemas/user.schema.js';
import { HotelBookingsModule } from '../../src/modules/hotel-bookings/hotel-bookings.module.js';
import { HotelHoldService } from '../../src/modules/hotel-bookings/hotel-hold.service.js';
import { HotelReservation } from '../../src/modules/hotel-bookings/schemas/hotel-reservation.schema.js';
import { HotelsService } from '../../src/modules/hotels/hotels.service.js';
import { RoomNightInventory } from '../../src/modules/hotels/room-night-inventory.js';
import { PaymentsService } from '../../src/modules/payments/payments.service.js';
import { FakeActiveBookingsCheck } from '../fakes/active-bookings-check.fake.js';
import { FakeHotelsService } from '../fakes/hotels.fake.js';
import { FakePaymentsService } from '../fakes/payments.fake.js';
import { FakeRoomNightInventory } from '../fakes/room-night-inventory.fake.js';
import { loginAs } from '../support/auth.js';
import { clearCollections } from '../support/clear-collections.js';
import { FakeEvents } from '../support/fake-events.js';
import { HOOK_TIMEOUT } from '../support/mongo-memory.js';
import { createTestApp } from '../support/test-app.js';
import type { TestApp } from '../support/test-app.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1a801';
const ROOM = '6553a1f0c2b4e8a9d0f1a802';

describe('ACC-12: payment confirmation and self-deactivation', () => {
  let t: TestApp;
  let holds: HotelHoldService;
  let reservations: Model<HotelReservation>;
  let users: Model<User>;
  let emitter: EventEmitter2;
  let registry: ActiveBookingsCheckRegistry;
  const hotels = new FakeHotelsService();
  const inventory = new FakeRoomNightInventory(hotels);
  const payments = new FakePaymentsService();
  const events = new FakeEvents();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (b) =>
        b
          .overrideProvider(HotelsService)
          .useValue(hotels)
          .overrideProvider(RoomNightInventory)
          .useValue(inventory)
          .overrideProvider(PaymentsService)
          .useValue(payments)
          .overrideProvider(AppEvents)
          .useValue(events),
    });
    holds = t.moduleRef.get(HotelHoldService);
    reservations = t.connection.model<HotelReservation>(HotelReservation.name);
    users = t.connection.model<User>(User.name);
    emitter = t.moduleRef.get(EventEmitter2);
    registry = t.moduleRef.get(ActiveBookingsCheckRegistry, { strict: false });
    registry.register(new FakeActiveBookingsCheck(BookingType.FLIGHT));
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    events.clear();
    payments.refunds.length = 0;
    Object.assign(
      hotels,
      new FakeHotelsService({
        hotels: [
          {
            id: HOTEL,
            name: 'Nile View',
            address: '1 Corniche',
            cityId: 'cairo',
            countryCode: 'EG',
            photos: [],
            amenities: [],
            checkInTime: '14:00',
            checkOutTime: '12:00',
            cancellationPolicy: { tiers: [] },
            isActive: true,
            ratingSummary: { average: null, count: 0 },
          },
        ],
        rooms: [
          {
            id: ROOM,
            hotelId: HOTEL,
            name: '101',
            type: 'Double',
            beds: 1,
            maxOccupancy: 2,
            pricePerNightMinor: 10_000,
            isActive: true,
            availability: [
              {
                fromDate: toDateOnly('2027-01-01'),
                toDate: toDateOnly('2027-12-31'),
              },
            ],
            hasEverBeenReserved: false,
          },
        ],
        roomNights: [],
      }),
    );
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  const holdFor = (id: string) =>
    holds.hold(
      {
        hotelId: HOTEL,
        checkInDate: '2027-03-10',
        checkOutDate: '2027-03-12',
        rooms: [{ roomId: ROOM, adults: 1, childAges: [] }],
      },
      id,
    );
  const confirm = (bookingId: string) =>
    emitter.emitAsync(Events.PaymentSucceeded, {
      bookingType: BookingType.HOTEL,
      bookingId,
    });

  it('blocks deactivation after a reservation is confirmed through the real booking check', async () => {
    const u = await loginAs(t.connection, 'user');
    const hold = await holdFor(u.id);
    await confirm(hold.reservationId);

    const res = await t
      .http()
      .delete('/api/users/me')
      .set('Cookie', u.cookie)
      .send({ confirm: true });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.ActiveBookingsExist);
    expect((await users.findById(u.id).lean())?.status).toBe(UserStatus.ACTIVE);
    await t.http().get('/api/auth/me').set('Cookie', u.cookie).expect(200);
    expect(events.payloadsOf(Events.UserDeactivated)).toEqual([]);
  });

  it('cannot finish with both a deactivated owner and an upcoming confirmed reservation', async () => {
    const u = await loginAs(t.connection, 'user');
    const hold = await holdFor(u.id);
    const checked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.spyOn(registry, 'hasUpcomingConfirmed').mockImplementationOnce(
      async (id, options?: { session: ClientSession }) => {
        const found = await reservations
          .exists({
            userId: id,
            status: 'confirmed',
            checkInDate: { $gt: new Date() },
          })
          .session(options?.session ?? null);
        checked.resolve();
        await release.promise;
        return Boolean(found);
      },
    );
    const deactivation = t
      .http()
      .delete('/api/users/me')
      .set('Cookie', u.cookie)
      .send({ confirm: true })
      .then((res) => res);
    await checked.promise;
    const payment = confirm(hold.reservationId);
    release.resolve();
    const results = await Promise.allSettled([deactivation, payment]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const res = await deactivation;
    const reservation = await reservations.findById(hold.reservationId).lean();
    const user = await users.findById(u.id).lean();
    if (res.status === 204) {
      expect(user?.status).toBe(UserStatus.DEACTIVATED);
      expect(reservation?.status).toBe('expired');
      expect(hotels.data.roomNights).toEqual([]);
      expect(payments.refunds).toEqual([
        expect.objectContaining({
          bookingId: hold.reservationId,
          amountMinor: hold.totalMinor,
          currency: 'USD',
          reason: 'late_payment',
        }),
      ]);
      expect(events.payloadsOf(Events.HotelReservationConfirmed)).toEqual([]);
      await confirm(hold.reservationId);
      expect(payments.refunds).toHaveLength(1);
    } else {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.ActiveBookingsExist);
      expect(user?.status).toBe(UserStatus.ACTIVE);
      expect(reservation?.status).toBe('confirmed');
      expect(hotels.data.roomNights).toHaveLength(2);
      expect(payments.refunds).toEqual([]);
    }
  });
});
