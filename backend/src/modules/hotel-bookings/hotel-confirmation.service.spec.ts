import { EventEmitter2 } from '@nestjs/event-emitter';
import { loginAs } from '../../../test/support/auth.js';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { User, UserStatus } from '../accounts/schemas/user.schema.js';
import { RESERVATION_REFERENCE } from './hotel-confirmation.service.js';
import type { HotelHoldRequestDto } from './dto/hotel-hold.dto.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelHoldExpiryJob } from './hotel-hold-expiry.job.js';
import { HotelHoldService } from './hotel-hold.service.js';
import { HotelReservation } from './schemas/hotel-reservation.schema.js';
import { HotelActiveBookings } from './hotel-active-bookings.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1a801';
const ROOM_101 = '6553a1f0c2b4e8a9d0f1a802';
const ROOM_102 = '6553a1f0c2b4e8a9d0f1a803';
let USER: string;

const room = (id: string, name: string) => ({
  id,
  hotelId: HOTEL,
  name,
  type: 'Double',
  beds: 1,
  maxOccupancy: 2,
  pricePerNightMinor: 10_000,
  isActive: true,
  availability: [
    { fromDate: toDateOnly('2027-01-01'), toDate: toDateOnly('2027-12-31') },
  ],
  hasEverBeenReserved: false,
});

function seededHotels(): FakeHotelsService {
  return new FakeHotelsService({
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
    rooms: [room(ROOM_101, '101'), room(ROOM_102, '102')],
    roomNights: [],
  });
}

const stay = (roomId = ROOM_101): HotelHoldRequestDto => ({
  hotelId: HOTEL,
  checkInDate: '2027-03-10',
  checkOutDate: '2027-03-12',
  rooms: [{ roomId, adults: 1, childAges: [] }],
});

describe('HotelConfirmationService: payment.succeeded (HTL-17)', () => {
  let t: TestApp;
  let holds: HotelHoldService;
  let reservations: Model<HotelReservation>;
  let emitter: EventEmitter2;
  let job: HotelHoldExpiryJob;
  // Kareem's working fake: it records every refund request (PAY-03 is a stub).
  const payments = new FakePaymentsService();
  const hotels = new FakeHotelsService();
  const inventory = new FakeRoomNightInventory(hotels);
  const events = new FakeEvents();
  // The references the service will use next, in order (see RESERVATION_REFERENCE).
  const nextReferences: string[] = [];
  let counter = 0;
  const testReference = () =>
    nextReferences.shift() ?? `HRT${String((counter += 1)).padStart(5, '0')}`;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(HotelsService)
          .useValue(hotels)
          .overrideProvider(RoomNightInventory)
          .useValue(inventory)
          .overrideProvider(AppEvents)
          .useValue(events)
          .overrideProvider(RESERVATION_REFERENCE)
          .useValue(testReference)
          .overrideProvider(PaymentsService)
          .useValue(payments),
    });
    holds = t.moduleRef.get(HotelHoldService);
    reservations = t.moduleRef.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
    emitter = t.moduleRef.get(EventEmitter2);
    job = t.moduleRef.get(HotelHoldExpiryJob);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    Object.assign(hotels, seededHotels());
    events.clear();
    payments.refunds.length = 0;
    nextReferences.length = 0;
    await clearCollections(t.connection);
    USER = (await loginAs(t.connection, 'user')).id;
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  /** What payments emits once Stripe confirms the payment (PAY-01). */
  const paymentSucceeded = (
    bookingId: string,
    bookingType = 'hotel' as const,
  ) => emitter.emitAsync(Events.PaymentSucceeded, { bookingType, bookingId });

  const saved = (id: string) => reservations.findById(id).lean();
  const nightsOf = (reservationId: string) =>
    hotels.data.roomNights.filter(
      (n) => n.kind === 'reservation' && n.reservationId === reservationId,
    );

  it('confirms the reservation with a reference, and keeps its nights', async () => {
    const hold = await holds.hold(stay(), USER);
    nextReferences.push('HRAB12CD');
    const check = t.moduleRef.get(HotelActiveBookings);
    expect(await check.hasUpcomingConfirmed(USER)).toBe(false);

    await paymentSucceeded(hold.reservationId);

    const after = await saved(hold.reservationId);
    expect(after).toMatchObject({ status: 'confirmed', reference: 'HRAB12CD' });
    expect(after?.confirmedAt).toBeInstanceOf(Date);
    expect(nightsOf(hold.reservationId)).toHaveLength(2);
    expect(await check.hasUpcomingConfirmed(USER)).toBe(true);
    expect(
      await check.hasUpcomingConfirmed(new Types.ObjectId().toHexString()),
    ).toBe(false);
  });

  it('emits HotelReservationConfirmed once, after the change', async () => {
    const hold = await holds.hold(stay(), USER);
    nextReferences.push('HRAB12CD');

    await paymentSucceeded(hold.reservationId);

    expect(events.payloadsOf(Events.HotelReservationConfirmed)).toEqual([
      { bookingId: hold.reservationId, userId: USER, reference: 'HRAB12CD' },
    ]);
  });

  // Stripe can deliver the same event twice; payments may re-emit it.
  it('is idempotent: the same event twice confirms once', async () => {
    const hold = await holds.hold(stay(), USER);
    nextReferences.push('HRAB12CD', 'HRZZ99ZZ');

    await paymentSucceeded(hold.reservationId);
    await paymentSucceeded(hold.reservationId);

    expect(await saved(hold.reservationId)).toMatchObject({
      status: 'confirmed',
      reference: 'HRAB12CD', // not replaced by the second event
    });
    expect(events.payloadsOf(Events.HotelReservationConfirmed)).toHaveLength(1);
  });

  it('ignores a flight payment', async () => {
    const hold = await holds.hold(stay(), USER);

    await emitter.emitAsync(Events.PaymentSucceeded, {
      bookingType: 'flight',
      bookingId: hold.reservationId,
    });

    expect((await saved(hold.reservationId))?.status).toBe('pending_payment');
    expect(events.emitted).toEqual([]);
  });

  it('does nothing for an unknown reservation', async () => {
    await expect(
      paymentSucceeded(new Types.ObjectId().toHexString()),
    ).resolves.toBeDefined();
    expect(events.emitted).toEqual([]);
  });

  // References are unique (a partial unique index); a clash is retried.
  it('retries with a new reference when the first one is taken', async () => {
    const first = await holds.hold(stay(ROOM_101), USER);
    const second = await holds.hold(stay(ROOM_102), USER);
    nextReferences.push('HRSAME00');
    await paymentSucceeded(first.reservationId);

    nextReferences.push('HRSAME00', 'HRNEW000'); // clash, then a free one
    await paymentSucceeded(second.reservationId);

    expect(await saved(second.reservationId)).toMatchObject({
      status: 'confirmed',
      reference: 'HRNEW000',
    });
    expect((await saved(first.reservationId))?.reference).toBe('HRSAME00');
    expect(events.payloadsOf(Events.HotelReservationConfirmed)).toHaveLength(2);
  });

  // §8.6 / data-model §8 #14: a payment that arrives after the hold expired is
  // not confirmed (the rooms may be gone); the user gets all their money back.
  describe('late payment', () => {
    it('expires a pending reservation for a deactivated owner, releases nights and requests a full refund', async () => {
      const hold = await holds.hold(stay(), USER);
      await t.connection
        .model<User>(User.name)
        .updateOne(
          { _id: USER, status: UserStatus.ACTIVE },
          { $set: { status: UserStatus.DEACTIVATED } },
        );

      await paymentSucceeded(hold.reservationId);
      await paymentSucceeded(hold.reservationId);

      expect((await saved(hold.reservationId))?.status).toBe('expired');
      expect(nightsOf(hold.reservationId)).toEqual([]);
      expect(payments.refunds).toEqual([
        expect.objectContaining({
          bookingId: hold.reservationId,
          amountMinor: hold.totalMinor,
          reason: 'late_payment',
        }),
      ]);
      expect(events.payloadsOf(Events.HotelReservationConfirmed)).toEqual([]);
      expect(events.payloadsOf(Events.HotelReservationExpired)).toHaveLength(1);
    });

    it('keeps an existing booking valid when its owner is suspended', async () => {
      const hold = await holds.hold(stay(), USER);
      await t.connection
        .model<User>(User.name)
        .updateOne(
          { _id: USER, status: UserStatus.ACTIVE },
          { $set: { status: UserStatus.SUSPENDED } },
        );

      await paymentSucceeded(hold.reservationId);

      expect((await saved(hold.reservationId))?.status).toBe('confirmed');
      expect(nightsOf(hold.reservationId)).toHaveLength(2);
      expect(payments.refunds).toEqual([]);
    });

    it('rolls back expiry and emits no event or refund if releasing nights fails', async () => {
      const hold = await holds.hold(stay(), USER);
      await t.connection
        .model<User>(User.name)
        .updateOne(
          { _id: USER, status: UserStatus.ACTIVE },
          { $set: { status: UserStatus.DEACTIVATED } },
        );
      const release = vi
        .spyOn(inventory, 'release')
        .mockRejectedValueOnce(new Error('Inventory release failed'));
      try {
        await paymentSucceeded(hold.reservationId);
      } finally {
        release.mockRestore();
      }

      expect((await saved(hold.reservationId))?.status).toBe('pending_payment');
      expect(nightsOf(hold.reservationId)).toHaveLength(2);
      expect(payments.refunds).toEqual([]);
      expect(events.emitted).toEqual([]);
    });

    it('refunds an expired reservation in full instead of confirming it', async () => {
      const hold = await holds.hold(stay(), USER);
      await job.expireDueHolds(hold.holdExpiresAt);

      await paymentSucceeded(hold.reservationId);

      expect(payments.refunds).toEqual([
        expect.objectContaining({
          bookingType: 'hotel',
          bookingId: hold.reservationId,
          amountMinor: hold.totalMinor,
          currency: 'USD',
          reason: 'late_payment',
        }),
      ]);
      expect((await saved(hold.reservationId))?.status).toBe('expired');
      expect(events.payloadsOf(Events.HotelReservationConfirmed)).toEqual([]);
    });

    it('asks for the refund once when the late event arrives twice', async () => {
      const hold = await holds.hold(stay(), USER);
      await job.expireDueHolds(hold.holdExpiresAt);
      const refund = vi.spyOn(payments, 'refund');

      await paymentSucceeded(hold.reservationId);
      await paymentSucceeded(hold.reservationId);

      // payments returns the existing refund for a booking, so one stays one.
      expect(payments.refunds).toHaveLength(1);
      expect(refund.mock.calls.every(([r]) => r.userId === USER)).toBe(true);
    });

    it('never refunds a confirmed reservation that gets a duplicate event', async () => {
      const hold = await holds.hold(stay(), USER);

      await paymentSucceeded(hold.reservationId);
      await paymentSucceeded(hold.reservationId);

      expect((await saved(hold.reservationId))?.status).toBe('confirmed');
      expect(payments.refunds).toEqual([]);
    });

    it('has exactly one outcome when payment and expiry race', async () => {
      const hold = await holds.hold(stay(), USER);

      await Promise.allSettled([
        paymentSucceeded(hold.reservationId),
        job.expireDueHolds(new Date(hold.holdExpiresAt.getTime() + 1)),
      ]);

      // Assert the invariant, never which one won.
      const status = (await saved(hold.reservationId))?.status;
      if (status === 'confirmed') {
        expect(payments.refunds).toEqual([]);
        expect(nightsOf(hold.reservationId)).toHaveLength(2);
      } else {
        expect(status).toBe('expired');
        expect(payments.refunds).toHaveLength(1);
      }
    });
  });
});
