import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { BOOKING_REFERENCE } from './flight-confirmation.service.js';
import { FlightHoldExpiryJob } from './flight-hold-expiry.job.js';
import { FlightHoldService } from './flight-hold.service.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

const AIRLINE = '6553a1f0c2b4e8a9d0f1e101';
const OUT = '6553a1f0c2b4e8a9d0f1e102';
const OUT_ECO = '6553a1f0c2b4e8a9d0f1e103';
const BACK = '6553a1f0c2b4e8a9d0f1e104';
const BACK_ECO = '6553a1f0c2b4e8a9d0f1e105';
const USER = '6553a1f0c2b4e8a9d0f1e199';

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS' });
  const flight = (
    id: string,
    cabinId: string,
    from: string,
    to: string,
    departureAt: Date,
  ) =>
    data.addFlight({
      id,
      airlineId: AIRLINE,
      flightNumber: 'MS100',
      departureAirportId: from,
      arrivalAirportId: to,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * 3_600_000),
      cabins: [
        {
          id: cabinId,
          cabinClass: 'economy',
          totalSeats: 50,
          priceMinor: 20_000,
        },
      ],
    });
  flight(OUT, OUT_ECO, 'CAI', 'DXB', new Date('2027-03-10T08:00:00Z'));
  flight(BACK, BACK_ECO, 'DXB', 'CAI', new Date('2027-03-17T08:00:00Z'));
  return data;
}

const adult = {
  type: 'adult' as const,
  fullName: 'Aya Amr',
  dateOfBirth: '1990-01-01',
  documentNumber: 'A1234567',
  extraBagCount: 0,
};
const oneWay: FlightQuoteRequestDto = {
  tripType: 'one_way',
  segments: [{ flightId: OUT, cabinId: OUT_ECO }],
  passengers: [adult, adult],
};
const roundTrip: FlightQuoteRequestDto = {
  tripType: 'round_trip',
  segments: [
    { flightId: OUT, cabinId: OUT_ECO },
    { flightId: BACK, cabinId: BACK_ECO },
  ],
  passengers: [adult],
};

describe('FlightConfirmationService: payment.succeeded (FLT-23)', () => {
  let t: TestApp;
  let holds: FlightHoldService;
  let job: FlightHoldExpiryJob;
  let bookings: Model<FlightBooking>;
  let emitter: EventEmitter2;
  const flights = new FakeFlightsService();
  const seats = new FakeSeatInventory();
  const events = new FakeEvents();
  const payments = new FakePaymentsService();
  // The references the service will use next, in order (see BOOKING_REFERENCE).
  const nextReferences: string[] = [];
  let counter = 0;
  const testReference = () =>
    nextReferences.shift() ?? `FBT${String((counter += 1)).padStart(5, '0')}`;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(flights)
          .overrideProvider(SeatInventory)
          .useValue(seats)
          .overrideProvider(AppEvents)
          .useValue(events)
          .overrideProvider(PaymentsService)
          .useValue(payments)
          .overrideProvider(BOOKING_REFERENCE)
          .useValue(testReference),
    });
    holds = t.moduleRef.get(FlightHoldService);
    job = t.moduleRef.get(FlightHoldExpiryJob);
    bookings = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    emitter = t.moduleRef.get(EventEmitter2);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    const data = seedFlights();
    Object.assign(flights, new FakeFlightsService(data));
    Object.assign(seats, new FakeSeatInventory(data));
    events.clear();
    payments.refunds.length = 0;
    nextReferences.length = 0;
    await clearCollections(t.connection);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  /** What payments emits once Stripe confirms the payment (PAY-01). */
  const paymentSucceeded = (bookingId: string) =>
    emitter.emitAsync(Events.PaymentSucceeded, {
      bookingType: 'flight',
      bookingId,
    });
  const saved = (id: string) => bookings.findById(id).lean();

  it('confirms the booking with a reference and turns its held seats into booked seats', async () => {
    const hold = await holds.hold(oneWay, USER);
    nextReferences.push('FBAB12CD');

    await paymentSucceeded(hold.bookingId);

    const after = await saved(hold.bookingId);
    expect(after).toMatchObject({ status: 'confirmed', reference: 'FBAB12CD' });
    expect(after?.confirmedAt).toBeInstanceOf(Date);
    expect(seats.counters(OUT, OUT_ECO)).toMatchObject({
      availableSeats: 48,
      heldSeats: 0,
      bookedSeats: 2,
    });
  });

  it('books the seats of both segments of a round trip', async () => {
    const hold = await holds.hold(roundTrip, USER);

    await paymentSucceeded(hold.bookingId);

    expect(seats.counters(OUT, OUT_ECO)).toMatchObject({
      heldSeats: 0,
      bookedSeats: 1,
    });
    expect(seats.counters(BACK, BACK_ECO)).toMatchObject({
      heldSeats: 0,
      bookedSeats: 1,
    });
  });

  it('emits FlightBookingConfirmed once, after the change', async () => {
    const hold = await holds.hold(oneWay, USER);
    nextReferences.push('FBAB12CD');

    await paymentSucceeded(hold.bookingId);

    expect(events.payloadsOf(Events.FlightBookingConfirmed)).toEqual([
      { bookingId: hold.bookingId, userId: USER, reference: 'FBAB12CD' },
    ]);
  });

  // Stripe can deliver the same event twice; payments may re-emit it.
  it('is idempotent: the same event twice confirms and books the seats once', async () => {
    const hold = await holds.hold(oneWay, USER);
    nextReferences.push('FBAB12CD', 'FBZZ99ZZ');

    await paymentSucceeded(hold.bookingId);
    await paymentSucceeded(hold.bookingId);

    expect(await saved(hold.bookingId)).toMatchObject({
      status: 'confirmed',
      reference: 'FBAB12CD',
    });
    expect(seats.counters(OUT, OUT_ECO)?.bookedSeats).toBe(2);
    expect(events.payloadsOf(Events.FlightBookingConfirmed)).toHaveLength(1);
  });

  it('ignores a hotel payment', async () => {
    const hold = await holds.hold(oneWay, USER);

    await emitter.emitAsync(Events.PaymentSucceeded, {
      bookingType: 'hotel',
      bookingId: hold.bookingId,
    });

    expect((await saved(hold.bookingId))?.status).toBe('pending_payment');
    expect(events.emitted).toEqual([]);
  });

  it.each([
    ['an unknown booking', new Types.ObjectId().toHexString()],
    ['a malformed id', 'not-an-id'],
  ])('does nothing for %s', async (_label, bookingId) => {
    await paymentSucceeded(bookingId);
    expect(events.emitted).toEqual([]);
    expect(payments.refunds).toEqual([]);
  });

  // References are unique (a partial unique index); a clash is retried.
  it('retries with a new reference when the first one is taken', async () => {
    const first = await holds.hold(oneWay, USER);
    const second = await holds.hold(oneWay, USER);
    nextReferences.push('FBSAME00');
    await paymentSucceeded(first.bookingId);

    nextReferences.push('FBSAME00', 'FBNEW000'); // clash, then a free one
    await paymentSucceeded(second.bookingId);

    expect(await saved(second.bookingId)).toMatchObject({
      status: 'confirmed',
      reference: 'FBNEW000',
    });
    // Each booking's seats were booked once, the clash didn't book them twice.
    expect(seats.counters(OUT, OUT_ECO)).toMatchObject({
      heldSeats: 0,
      bookedSeats: 4,
    });
  });

  // The status change and the seat change are one transaction (§6).
  it('rolls the confirmation back when booking the seats fails', async () => {
    const hold = await holds.hold(oneWay, USER);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(t.moduleRef.get(SeatInventory), 'confirm').mockRejectedValueOnce(
      new Error('inventory down'),
    );

    await paymentSucceeded(hold.bookingId);

    const after = await saved(hold.bookingId);
    expect(after?.status).toBe('pending_payment');
    expect(after?.reference).toBeUndefined();
    expect(events.emitted).toEqual([]);
  });

  // §8.6, data-model §8 #14: a payment that arrives after the hold expired is
  // not confirmed (the seats may be gone); the user gets all their money back.
  describe('late payment', () => {
    it('refunds an expired booking in full instead of confirming it', async () => {
      const hold = await holds.hold(oneWay, USER);
      await job.expireDueHolds(hold.holdExpiresAt);

      await paymentSucceeded(hold.bookingId);

      expect(payments.refunds).toEqual([
        expect.objectContaining({
          bookingType: 'flight',
          bookingId: hold.bookingId,
          amountMinor: hold.pricing.totalMinor,
          currency: 'USD',
          reason: 'late_payment',
        }),
      ]);
      expect((await saved(hold.bookingId))?.status).toBe('expired');
      expect(seats.counters(OUT, OUT_ECO)?.bookedSeats).toBe(0);
      expect(events.payloadsOf(Events.FlightBookingConfirmed)).toEqual([]);
    });

    it('asks for the refund once when the late event arrives twice', async () => {
      const hold = await holds.hold(oneWay, USER);
      await job.expireDueHolds(hold.holdExpiresAt);

      await paymentSucceeded(hold.bookingId);
      await paymentSucceeded(hold.bookingId);

      expect(payments.refunds).toHaveLength(1);
    });

    it('never refunds a confirmed booking that gets a duplicate event', async () => {
      const hold = await holds.hold(oneWay, USER);

      await paymentSucceeded(hold.bookingId);
      await paymentSucceeded(hold.bookingId);

      expect((await saved(hold.bookingId))?.status).toBe('confirmed');
      expect(payments.refunds).toEqual([]);
    });

    it('has exactly one outcome when payment and expiry race', async () => {
      const hold = await holds.hold(oneWay, USER);

      await Promise.allSettled([
        paymentSucceeded(hold.bookingId),
        job.expireDueHolds(new Date(hold.holdExpiresAt.getTime() + 1)),
      ]);

      // Assert the invariant, never which one won.
      const status = (await saved(hold.bookingId))?.status;
      const counters = seats.counters(OUT, OUT_ECO);
      if (status === 'confirmed') {
        expect(counters).toMatchObject({ heldSeats: 0, bookedSeats: 2 });
        expect(payments.refunds).toEqual([]);
      } else {
        expect(status).toBe('expired');
        expect(counters).toMatchObject({ availableSeats: 50, bookedSeats: 0 });
        expect(payments.refunds).toHaveLength(1);
      }
    });
  });
});
