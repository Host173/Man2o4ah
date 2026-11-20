import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import {
  BACK,
  BACK_AT,
  HOUR,
  OTHER,
  OUT,
  OUT_AT,
  USER,
  seedBooking,
  seedFlights,
} from '../../../test/support/flight-booking-fixtures.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { transitionStatus } from './booking-lifecycle.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightCancellationService } from './flight-cancellation.service.js';
import { FlightRescheduleSyncService } from './flight-reschedule-sync.service.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

const NOW = new Date('2027-03-01T00:00:00.000Z');
/** OUT moved from 03-10 08:00 to 03-12 09:30, landing 4 h 30 min later. */
const MOVED_AT = new Date('2027-03-12T09:30:00.000Z');
const MOVED_ARRIVAL = new Date('2027-03-12T14:00:00.000Z');

const moved = (
  flightId: string,
  departureAt = MOVED_AT,
  arrivalAt = MOVED_ARRIVAL,
) => ({
  flightId,
  departureAt,
  arrivalAt,
});

describe('FlightRescheduleSyncService (FLT-05 bookings side)', () => {
  let t: TestApp;
  let service: FlightRescheduleSyncService;
  let bookings: Model<FlightBooking>;
  const flights = new FakeFlightsService();
  const seats = new FakeSeatInventory();
  const payments = new FakePaymentsService();
  const events = new FakeEvents();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(flights)
          .overrideProvider(SeatInventory)
          .useValue(seats)
          .overrideProvider(PaymentsService)
          .useValue(payments)
          .overrideProvider(AppEvents)
          .useValue(events),
    });
    service = t.moduleRef.get(FlightRescheduleSyncService);
    bookings = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    const data = seedFlights();
    Object.assign(flights, new FakeFlightsService(data));
    Object.assign(seats, new FakeSeatInventory(data));
    payments.refunds.length = 0;
    events.clear();
    await clearCollections(t.connection);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  const seed = (options: Parameters<typeof seedBooking>[2] = {}) =>
    seedBooking(bookings, seats, options);
  const find = (id: string) => bookings.findById(id).lean();

  it('syncs the times of a confirmed booking and tells the passengers once', async () => {
    const booking = await seed();

    await service.sync(moved(OUT));

    const saved = await find(booking.id);
    expect(saved?.segments[0]).toMatchObject({
      departureAt: MOVED_AT,
      arrivalAt: MOVED_ARRIVAL,
    });
    expect(saved?.firstDepartureAt).toEqual(MOVED_AT);
    expect(saved?.lastDepartureAt).toEqual(MOVED_AT);
    const [sent, ...others] = events.payloadsOf(
      Events.FlightBookingRescheduled,
    );
    expect(others).toEqual([]);
    expect(sent).toEqual({
      eventId: expect.stringMatching(/\S/),
      bookingId: booking.id,
      userId: USER,
    });
  });

  it('moving the outbound flight of a round trip changes only the first departure', async () => {
    const booking = await seed({ back: BACK });

    await service.sync(moved(OUT));

    const saved = await find(booking.id);
    expect(saved?.segments[0].departureAt).toEqual(MOVED_AT);
    expect(saved?.segments[1].departureAt).toEqual(BACK_AT);
    expect(saved?.firstDepartureAt).toEqual(MOVED_AT);
    expect(saved?.lastDepartureAt).toEqual(BACK_AT);
  });

  it('moving the return flight of a round trip changes only the last departure', async () => {
    const booking = await seed({ back: BACK });
    const later = new Date('2027-03-19T06:00:00.000Z');

    await service.sync(
      moved(BACK, later, new Date(later.getTime() + 4 * HOUR)),
    );

    const saved = await find(booking.id);
    expect(saved?.segments[0].departureAt).toEqual(OUT_AT);
    expect(saved?.segments[1].departureAt).toEqual(later);
    expect(saved?.firstDepartureAt).toEqual(OUT_AT);
    expect(saved?.lastDepartureAt).toEqual(later);
  });

  it('syncs a change of the arrival time alone', async () => {
    const booking = await seed();
    const arrival = new Date(OUT_AT.getTime() + 6 * HOUR);

    await service.sync(moved(OUT, OUT_AT, arrival));

    const saved = await find(booking.id);
    expect(saved?.segments[0]).toMatchObject({
      departureAt: OUT_AT,
      arrivalAt: arrival,
    });
    expect(events.payloadsOf(Events.FlightBookingRescheduled)).toHaveLength(1);
  });

  it('syncs a pending booking without notifying anyone (nothing is confirmed yet)', async () => {
    const booking = await seed({ status: 'pending_payment' });

    await service.sync(moved(OUT));

    const saved = await find(booking.id);
    expect(saved?.firstDepartureAt).toEqual(MOVED_AT);
    expect(saved?.segments[0].departureAt).toEqual(MOVED_AT);
    expect(events.emitted).toHaveLength(0);
  });

  it.each(['completed', 'expired', 'cancelled'] as const)(
    'leaves a %s booking alone',
    async (status) => {
      const booking = await seed({ status });

      await service.sync(moved(OUT));

      const saved = await find(booking.id);
      expect(saved?.firstDepartureAt).toEqual(OUT_AT);
      expect(saved?.segments[0].departureAt).toEqual(OUT_AT);
      expect(events.emitted).toHaveLength(0);
    },
  );

  it('leaves bookings of other flights alone', async () => {
    const other = await seed({ outbound: OTHER });

    await service.sync(moved(OUT));

    expect((await find(other.id))?.firstDepartureAt).toEqual(
      other.firstDepartureAt,
    );
    expect(events.emitted).toHaveLength(0);
  });

  it('syncs every booking of the flight, one notification each', async () => {
    const a = await seed();
    const b = await seed({ back: BACK });
    const c = await seed();

    await service.sync(moved(OUT));

    for (const booking of [a, b, c]) {
      expect((await find(booking.id))?.firstDepartureAt).toEqual(MOVED_AT);
    }
    const sent = events.payloadsOf(Events.FlightBookingRescheduled);
    expect(sent.map((e) => e.bookingId).sort()).toEqual(
      [a.id, b.id, c.id].sort(),
    );
    expect(new Set(sent.map((e) => e.eventId)).size).toBe(3);
  });

  it('is idempotent: the same event delivered twice syncs and notifies once', async () => {
    const booking = await seed();

    await service.sync(moved(OUT));
    await service.sync(moved(OUT));

    expect((await find(booking.id))?.firstDepartureAt).toEqual(MOVED_AT);
    expect(events.payloadsOf(Events.FlightBookingRescheduled)).toHaveLength(1);
  });

  it('gives a later, different change its own notification', async () => {
    await seed();
    await service.sync(moved(OUT));
    const evenLater = new Date('2027-03-14T11:00:00.000Z');

    await service.sync(
      moved(OUT, evenLater, new Date(evenLater.getTime() + 4 * HOUR)),
    );

    const sent = events.payloadsOf(Events.FlightBookingRescheduled);
    expect(sent).toHaveLength(2);
    expect(sent[0].eventId).not.toBe(sent[1].eventId);
  });

  it('syncs in the same moment as a payment confirms the booking, without losing either', async () => {
    const booking = await seed({ status: 'pending_payment' });

    await Promise.all([
      service.sync(moved(OUT)),
      transitionStatus(bookings, booking.id, 'pending_payment', 'confirmed', {
        confirmedAt: NOW,
        reference: 'FBRACE01',
      }),
    ]);

    const saved = await find(booking.id);
    expect(saved?.status).toBe('confirmed');
    expect(saved?.firstDepartureAt).toEqual(MOVED_AT);
    expect(saved?.segments[0].departureAt).toEqual(MOVED_AT);
  });

  it('makes refunds use the new departure', async () => {
    const booking = await seed();
    const cancellations = t.moduleRef.get(FlightCancellationService);
    // 03-10 08:00 is 9 full days away (tiers: 3 days → 50%).
    expect((await cancellations.refundPreview(booking.id, USER)).percent).toBe(
      50,
    );

    await service.sync(
      moved(
        OUT,
        new Date('2027-03-03T08:00:00.000Z'),
        new Date('2027-03-03T12:00:00.000Z'),
      ),
    );

    // Now 2 full days away: below the 3-day tier.
    expect((await cancellations.refundPreview(booking.id, USER)).percent).toBe(
      0,
    );
  });

  it('handles the flight.rescheduled event', async () => {
    const booking = await seed();

    await t.moduleRef
      .get(EventEmitter2)
      .emitAsync(Events.FlightRescheduled, moved(OUT));

    expect((await find(booking.id))?.firstDepartureAt).toEqual(MOVED_AT);
    expect(events.payloadsOf(Events.FlightBookingRescheduled)).toHaveLength(1);
  });

  it('never throws out of the event handler, even for an invalid flight id', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      service.onFlightRescheduled(moved('not-an-id')),
    ).resolves.toBeUndefined();
    await expect(service.sync(moved('not-an-id'))).resolves.toBeUndefined();
  });
});
