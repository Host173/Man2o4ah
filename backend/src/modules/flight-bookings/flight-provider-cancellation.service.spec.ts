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
  BACK_ECO,
  OTHER,
  OTHER_ECO,
  OUT,
  OUT_ECO,
  USER,
  seedBooking,
  seedFlights,
} from '../../../test/support/flight-booking-fixtures.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightCancellationService } from './flight-cancellation.service.js';
import { FlightProviderCancellationService } from './flight-provider-cancellation.service.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

const NOW = new Date('2027-03-01T00:00:00.000Z');

describe('FlightProviderCancellationService (FLT-06 bookings side, GEN-11)', () => {
  let t: TestApp;
  let service: FlightProviderCancellationService;
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
    service = t.moduleRef.get(FlightProviderCancellationService);
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
  const counters = (flight: string, cabin: string) =>
    seats.counters(flight, cabin);

  it('cancels a confirmed booking at 100% as the provider, returns its seats, refunds and notifies', async () => {
    const booking = await seed();

    await service.cancelBookingsOf(OUT, NOW);

    const saved = await find(booking.id);
    expect(saved?.status).toBe('cancelled');
    expect(saved?.cancellation).toMatchObject({
      cancelledAt: NOW,
      cancelledBy: 'provider',
      refundPercent: 100,
      refundAmountMinor: 40_000,
    });
    expect(counters(OUT, OUT_ECO)).toMatchObject({
      bookedSeats: 0,
      availableSeats: 50,
    });
    expect(payments.refunds).toEqual([
      expect.objectContaining({
        bookingType: BookingType.FLIGHT,
        bookingId: booking.id,
        amountMinor: 40_000,
        currency: 'USD',
        reason: 'provider_cancellation',
      }),
    ]);
    expect(events.payloadsOf(Events.FlightBookingCancelled)).toEqual([
      { bookingId: booking.id, userId: USER, reference: saved?.reference },
    ]);
    expect(events.payloadsOf(Events.FlightBookingExpired)).toEqual([]);
  });

  it('refunds 100% even when the booking’s own tiers would refund nothing', async () => {
    const booking = await seed();
    // One hour before departure the booking's tiers give 0%; the provider's fault is always 100%.
    vi.setSystemTime(new Date('2027-03-10T07:00:00.000Z'));

    await service.cancelBookingsOf(OUT, new Date());

    expect((await find(booking.id))?.cancellation).toMatchObject({
      refundPercent: 100,
      refundAmountMinor: 40_000,
    });
  });

  it.each([
    ['the outbound flight', OUT],
    ['the return flight', BACK],
  ])(
    'cancels a whole round trip when %s is cancelled, returning both flights’ seats',
    async (_label, cancelled) => {
      const booking = await seed({ back: BACK });

      await service.cancelBookingsOf(cancelled, NOW);

      expect((await find(booking.id))?.status).toBe('cancelled');
      expect(counters(OUT, OUT_ECO)).toMatchObject({ bookedSeats: 0 });
      expect(counters(BACK, BACK_ECO)).toMatchObject({ bookedSeats: 0 });
      expect(payments.refunds).toHaveLength(1);
    },
  );

  it('expires a pending booking, releases its held seats and tells payments, with no refund', async () => {
    const booking = await seed({ status: 'pending_payment' });
    expect(counters(OUT, OUT_ECO)).toMatchObject({ heldSeats: 2 });

    await service.cancelBookingsOf(OUT, NOW);

    const saved = await find(booking.id);
    expect(saved?.status).toBe('expired');
    expect(saved?.expiredAt).toEqual(NOW);
    expect(counters(OUT, OUT_ECO)).toMatchObject({
      heldSeats: 0,
      availableSeats: 50,
    });
    expect(payments.refunds).toHaveLength(0);
    expect(events.payloadsOf(Events.FlightBookingExpired)).toEqual([
      { bookingId: booking.id, userId: USER },
    ]);
    expect(events.payloadsOf(Events.FlightBookingCancelled)).toEqual([]);
  });

  it('handles every booking of the flight and only those', async () => {
    const a = await seed();
    const b = await seed({ status: 'pending_payment' });
    const c = await seed({ back: BACK });
    const unrelated = await seed({ outbound: OTHER });

    await expect(service.cancelBookingsOf(OUT, NOW)).resolves.toBe(3);

    expect((await find(a.id))?.status).toBe('cancelled');
    expect((await find(b.id))?.status).toBe('expired');
    expect((await find(c.id))?.status).toBe('cancelled');
    expect((await find(unrelated.id))?.status).toBe('confirmed');
    expect(counters(OTHER, OTHER_ECO)).toMatchObject({ bookedSeats: 2 });
  });

  it.each(['completed', 'expired', 'cancelled'] as const)(
    'leaves a %s booking alone',
    async (status) => {
      const booking = await seed({ status });

      await expect(service.cancelBookingsOf(OUT, NOW)).resolves.toBe(0);

      expect((await find(booking.id))?.status).toBe(status);
      expect(payments.refunds).toHaveLength(0);
      expect(events.emitted).toHaveLength(0);
    },
  );

  it('is idempotent: a second delivery changes, refunds and notifies nothing', async () => {
    const booking = await seed();
    await service.cancelBookingsOf(OUT, NOW);

    await expect(service.cancelBookingsOf(OUT, NOW)).resolves.toBe(0);

    expect((await find(booking.id))?.status).toBe('cancelled');
    expect(counters(OUT, OUT_ECO)).toMatchObject({
      bookedSeats: 0,
      availableSeats: 50,
    });
    expect(payments.refunds).toHaveLength(1);
    expect(events.payloadsOf(Events.FlightBookingCancelled)).toHaveLength(1);
  });

  it('does not refund a booking with a zero total', async () => {
    const booking = await seed({ totalMinor: 0 });
    const refund = vi.spyOn(payments, 'refund');

    await service.cancelBookingsOf(OUT, NOW);

    expect((await find(booking.id))?.status).toBe('cancelled');
    expect(refund).not.toHaveBeenCalled();
    expect(events.payloadsOf(Events.FlightBookingCancelled)).toHaveLength(1);
  });

  // S-08: flight.cancelled is never redelivered, so a failed booking is tried once more.
  it('retries a booking that fails once, so every booking ends cancelled', async () => {
    const first = await seed();
    const second = await seed();
    vi.spyOn(seats, 'returnBooked').mockRejectedValueOnce(
      new Error('Seat inventory unavailable'),
    );
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(service.cancelBookingsOf(OUT, NOW)).resolves.toBe(2);

    expect((await find(first.id))?.status).toBe('cancelled');
    expect((await find(second.id))?.status).toBe('cancelled');
    expect(counters(OUT, OUT_ECO)).toMatchObject({
      bookedSeats: 0,
      availableSeats: 50,
    });
    expect(payments.refunds).toHaveLength(2);
  });

  it('parks a booking that fails twice and finishes the others', async () => {
    const first = await seed();
    const second = await seed();
    vi.spyOn(seats, 'returnBooked')
      .mockRejectedValueOnce(new Error('Seat inventory unavailable'))
      .mockRejectedValueOnce(new Error('Seat inventory unavailable'));
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(service.cancelBookingsOf(OUT, NOW)).resolves.toBe(1);

    const statuses = [
      (await find(first.id))?.status,
      (await find(second.id))?.status,
    ];
    expect(statuses).toEqual(
      expect.arrayContaining(['cancelled', 'confirmed']),
    );
    // The parked booking was rolled back: seats and refunds belong to the cancelled one only.
    expect(counters(OUT, OUT_ECO)).toMatchObject({ bookedSeats: 2 });
    expect(payments.refunds).toHaveLength(1);
  });

  it('keeps the cancellation, notifies and carries on if a refund request throws', async () => {
    const first = await seed();
    const second = await seed();
    vi.spyOn(payments, 'refund').mockRejectedValueOnce(
      new Error('Payments unavailable'),
    );
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(service.cancelBookingsOf(OUT, NOW)).resolves.toBe(2);

    expect((await find(first.id))?.status).toBe('cancelled');
    expect((await find(second.id))?.status).toBe('cancelled');
    expect(events.payloadsOf(Events.FlightBookingCancelled)).toHaveLength(2);
    expect(payments.refunds).toHaveLength(1);
  });

  it('cancels, returns seats, refunds and notifies once when the user cancels at the same moment', async () => {
    const booking = await seed();
    const returnBooked = vi.spyOn(seats, 'returnBooked');

    await Promise.allSettled([
      t.moduleRef.get(FlightCancellationService).cancel(booking.id, USER),
      service.cancelBookingsOf(OUT, NOW),
    ]);

    expect((await find(booking.id))?.status).toBe('cancelled');
    expect(returnBooked).toHaveBeenCalledTimes(1);
    expect(counters(OUT, OUT_ECO)).toMatchObject({
      bookedSeats: 0,
      availableSeats: 50,
    });
    expect(payments.refunds).toHaveLength(1);
    expect(events.payloadsOf(Events.FlightBookingCancelled)).toHaveLength(1);
  });

  describe('a booking that moves on between the scan and its expiry', () => {
    // Runs `change` once, right before the handler opens its transaction: after
    // the scan saw the booking as pending_payment, like a payment would.
    function movesOnAfterTheScan(change: () => Promise<void>) {
      const startSession = t.connection.startSession.bind(t.connection);
      vi.spyOn(t.connection, 'startSession').mockImplementationOnce(
        async (options) => {
          await change();
          return startSession(options);
        },
      );
    }
    const items = [{ flightId: OUT, cabinId: OUT_ECO, seats: 2 }];

    it('re-handles a booking a payment confirmed between the scan and its expiry', async () => {
      const booking = await seed({ status: 'pending_payment' });
      movesOnAfterTheScan(async () => {
        await bookings.updateOne(
          { _id: booking._id },
          {
            $set: {
              status: 'confirmed',
              reference: 'FBRACE01',
              confirmedAt: NOW,
            },
          },
        );
        await seats.confirm(items);
      });

      await expect(service.cancelBookingsOf(OUT, NOW)).resolves.toBe(1);

      const saved = await find(booking.id);
      expect(saved?.status).toBe('cancelled');
      expect(saved?.cancellation).toMatchObject({
        cancelledBy: 'provider',
        refundPercent: 100,
        refundAmountMinor: 40_000,
      });
      expect(payments.refunds).toEqual([
        expect.objectContaining({
          bookingId: booking.id,
          amountMinor: 40_000,
          reason: 'provider_cancellation',
        }),
      ]);
      expect(events.payloadsOf(Events.FlightBookingCancelled)).toEqual([
        { bookingId: booking.id, userId: USER, reference: 'FBRACE01' },
      ]);
      expect(counters(OUT, OUT_ECO)).toMatchObject({
        bookedSeats: 0,
        availableSeats: 50,
      });
    });

    it('stops when the booking that moved on is finished, without refunds or events', async () => {
      const booking = await seed({ status: 'pending_payment' });
      movesOnAfterTheScan(async () => {
        await bookings.updateOne(
          { _id: booking._id },
          { $set: { status: 'expired', expiredAt: NOW } },
        );
      });

      await expect(service.cancelBookingsOf(OUT, NOW)).resolves.toBe(0);

      expect((await find(booking.id))?.status).toBe('expired');
      expect(payments.refunds).toHaveLength(0);
      expect(events.emitted).toHaveLength(0);
    });
  });

  it('handles the flight.cancelled event', async () => {
    const booking = await seed();

    await t.moduleRef
      .get(EventEmitter2)
      .emitAsync(Events.FlightCancelled, { flightId: OUT });

    expect((await find(booking.id))?.status).toBe('cancelled');
    expect(payments.refunds).toHaveLength(1);
  });

  it('never throws out of the event handler, even for an invalid flight id', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      service.onFlightCancelled({ flightId: 'not-an-id' }),
    ).resolves.toBeUndefined();
    await expect(service.cancelBookingsOf('not-an-id', NOW)).resolves.toBe(0);
  });
});
