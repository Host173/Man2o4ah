import { ConflictException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { MockInstance } from 'vitest';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { FlightsService } from '../flights/flights.service.js';
import type { InventoryOptions, SeatItem } from '../flights/flights.types.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightCancellationService } from './flight-cancellation.service.js';
import {
  FlightBooking,
  type FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

const AIRLINE = '6553a1f0c2b4e8a9d0f1c001';
const OUT = '6553a1f0c2b4e8a9d0f1c002';
const OUT_ECO = '6553a1f0c2b4e8a9d0f1c003';
const BACK = '6553a1f0c2b4e8a9d0f1c004';
const BACK_ECO = '6553a1f0c2b4e8a9d0f1c005';
const USER = '6553a1f0c2b4e8a9d0f1c099';

const OUT_AT = new Date('2027-03-10T08:00:00.000Z');
const BACK_AT = new Date('2027-03-17T08:00:00.000Z');
const HOUR = 3_600_000;

/** The booking's snapshot tiers: 80% from 7 days out, 50% from 3 days out, else 0%. */
const TIERS = [
  { daysBefore: 3, refundPercent: 50 },
  { daysBefore: 7, refundPercent: 80 },
];
const TOTAL = 40_000;

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS' });
  const flight = (id: string, cabinId: string, departureAt: Date) =>
    data.addFlight({
      id,
      airlineId: AIRLINE,
      flightNumber: 'MS100',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * HOUR),
      cabins: [
        {
          id: cabinId,
          cabinClass: 'economy',
          totalSeats: 50,
          priceMinor: 20_000,
        },
      ],
    });
  flight(OUT, OUT_ECO, OUT_AT);
  flight(BACK, BACK_ECO, BACK_AT);
  return data;
}

function segment(
  direction: 'outbound' | 'return',
  flightId: string,
  cabinId: string,
  departureAt: Date,
) {
  return {
    direction,
    flightId,
    cabinId,
    cabinClass: 'economy' as const,
    airlineId: AIRLINE,
    flightNumber: 'MS100',
    departureAirportId: direction === 'outbound' ? 'CAI' : 'DXB',
    arrivalAirportId: direction === 'outbound' ? 'DXB' : 'CAI',
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 4 * HOUR),
    fareMinor: 20_000,
    policy: {
      cancellationTiers: TIERS,
      freeBags: 1,
      maxBagWeightKg: 23,
      extraBagPriceMinor: 0,
      maxExtraBagsPerPassenger: 0,
    },
  };
}

const adult = (fullName: string) => ({
  type: 'adult' as const,
  fullName,
  dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
  documentNumber: 'A1234567',
  extraBagCount: 0,
});

describe('FlightCancellationService (FLT-26, GEN-11)', () => {
  let t: TestApp;
  let service: FlightCancellationService;
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
    service = t.moduleRef.get(FlightCancellationService);
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
    // Seats are held while the flights are still ahead; tests then move the clock.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  /**
   * Saves a booking with 2 passengers (2 seats). A confirmed one also has its
   * seats booked, like after a payment; `roundTrip` adds the return flight.
   */
  async function seed(
    options: {
      status?: FlightBookingStatus;
      roundTrip?: boolean;
      reference?: string | undefined;
    } = {},
  ) {
    const { status = 'confirmed', roundTrip = false } = options;
    const reference = 'reference' in options ? options.reference : 'FBCNL001';
    const segments = [segment('outbound', OUT, OUT_ECO, OUT_AT)];
    if (roundTrip) segments.push(segment('return', BACK, BACK_ECO, BACK_AT));
    const booking = await bookings.create({
      userId: USER,
      reference,
      status,
      tripType: roundTrip ? ('round_trip' as const) : ('one_way' as const),
      segments,
      passengers: [adult('Aya Amr'), adult('Jana Test')],
      seatCount: 2,
      pricing: {
        fareTotalMinor: TOTAL,
        baggageTotalMinor: 0,
        totalMinor: TOTAL,
        currency: 'USD',
      },
      holdExpiresAt: new Date('2027-03-01T00:10:00.000Z'),
      firstDepartureAt: OUT_AT,
      lastDepartureAt: roundTrip ? BACK_AT : OUT_AT,
    });
    if (status === 'confirmed') {
      const items = segments.map((s) => ({
        flightId: s.flightId,
        cabinId: s.cabinId,
        seats: 2,
      }));
      await seats.hold(items);
      await seats.confirm(items);
    }
    return booking;
  }

  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  const find = (id: string) => bookings.findById(id).lean();
  const counters = (flight: string, cabin: string) =>
    seats.counters(flight, cabin);

  it('previews the snapshot refund without changing anything', async () => {
    const booking = await seed();
    at('2027-03-01T00:00:00.000Z'); // 9 days and 8 hours before departure

    expect(await service.refundPreview(booking.id, USER)).toEqual({
      percent: 80,
      amountMinor: 32_000,
      currency: 'USD',
    });

    expect((await find(booking.id))?.status).toBe('confirmed');
    expect(counters(OUT, OUT_ECO)).toMatchObject({ bookedSeats: 2 });
    expect(payments.refunds).toHaveLength(0);
    expect(events.emitted).toHaveLength(0);
  });

  it('cancels, returns the seats in the same transaction, then refunds and notifies after the commit', async () => {
    const booking = await seed();
    // The fake ignores the session; the real SeatInventory requires it.
    const returnBooked = vi.spyOn(
      seats,
      'returnBooked',
    ) as unknown as MockInstance<
      (items: SeatItem[], options?: InventoryOptions) => Promise<void>
    >;
    returnBooked.mockImplementation(async (items, options) => {
      if (!options) throw new Error('Cancellation must pass its transaction');
      expect(options.session.inTransaction()).toBe(true);
      // Inside the transaction the booking is cancelled; outside it still isn't committed.
      expect((await find(booking.id))?.status).toBe('confirmed');
      expect(
        (await bookings.findById(booking.id).session(options.session).lean())
          ?.status,
      ).toBe('cancelled');
      return FakeSeatInventory.prototype.returnBooked.call(seats, items);
    });
    const refund = vi
      .spyOn(payments, 'refund')
      .mockImplementation(async (request) => {
        expect((await find(booking.id))?.status).toBe('cancelled');
        expect(counters(OUT, OUT_ECO)).toMatchObject({
          bookedSeats: 0,
          availableSeats: 50,
        });
        return FakePaymentsService.prototype.refund.call(payments, request);
      });

    const result = await service.cancel(booking.id, USER);

    expect(result).toMatchObject({
      _id: booking.id,
      reference: 'FBCNL001',
      status: 'cancelled',
      cancellation: {
        cancelledAt: new Date('2027-03-01T00:00:00.000Z'),
        cancelledBy: 'user',
        refundPercent: 80,
        refundAmountMinor: 32_000,
      },
      refund: { status: 'pending', amountMinor: 32_000, currency: 'USD' },
    });
    expect((await find(booking.id))?.cancellation).toMatchObject(
      result.cancellation,
    );
    expect(returnBooked).toHaveBeenCalledTimes(1);
    expect(returnBooked.mock.calls[0][0]).toEqual([
      { flightId: OUT, cabinId: OUT_ECO, seats: 2 },
    ]);
    expect(returnBooked.mock.calls[0][1]?.session.hasEnded).toBe(true);
    expect(refund).toHaveBeenCalledWith({
      bookingType: BookingType.FLIGHT,
      bookingId: booking.id,
      userId: USER,
      amountMinor: 32_000,
      currency: 'USD',
      reason: 'user_cancellation',
    });
    expect(events.payloadsOf(Events.FlightBookingCancelled)).toEqual([
      { bookingId: booking.id, userId: USER, reference: 'FBCNL001' },
    ]);
  });

  it('returns the seats of both flights of a round trip', async () => {
    const booking = await seed({ roundTrip: true });

    await service.cancel(booking.id, USER);

    expect(counters(OUT, OUT_ECO)).toMatchObject({
      bookedSeats: 0,
      availableSeats: 50,
    });
    expect(counters(BACK, BACK_ECO)).toMatchObject({
      bookedSeats: 0,
      availableSeats: 50,
    });
  });

  it('refunds on the outbound departure, whatever the return date', async () => {
    const booking = await seed({ roundTrip: true });
    at('2027-03-03T08:00:00.000Z'); // exactly 7 days before the outbound flight

    expect((await service.refundPreview(booking.id, USER)).percent).toBe(80);
  });

  // Decision table on the days left before the outbound departure (FLT-09).
  it.each([
    ['exactly 7 days', '2027-03-03T08:00:00.000Z', 80, 32_000],
    ['1 ms under 7 days', '2027-03-03T08:00:00.001Z', 50, 20_000],
    ['exactly 3 days', '2027-03-07T08:00:00.000Z', 50, 20_000],
    ['1 ms under 3 days', '2027-03-07T08:00:00.001Z', 0, 0],
    ['1 ms before departure', '2027-03-10T07:59:59.999Z', 0, 0],
  ])(
    'refunds the right tier %s before departure',
    async (_label, now, percent, amountMinor) => {
      const booking = await seed();
      at(now);

      expect(await service.refundPreview(booking.id, USER)).toEqual({
        percent,
        amountMinor,
        currency: 'USD',
      });
      const result = await service.cancel(booking.id, USER);

      expect(result.cancellation).toMatchObject({
        refundPercent: percent,
        refundAmountMinor: amountMinor,
      });
      expect(payments.refunds).toHaveLength(amountMinor > 0 ? 1 : 0);
      expect(result.refund).toEqual(
        amountMinor > 0 ? expect.objectContaining({ amountMinor }) : null,
      );
      // Cancelling still returns the seats and notifies when nothing is refunded.
      expect(counters(OUT, OUT_ECO)).toMatchObject({ bookedSeats: 0 });
      expect(events.payloadsOf(Events.FlightBookingCancelled)).toHaveLength(1);
    },
  );

  it('does not call payments for a zero refund', async () => {
    const booking = await seed();
    at('2027-03-09T08:00:00.000Z');
    const refund = vi.spyOn(payments, 'refund');

    expect((await service.cancel(booking.id, USER)).refund).toBeNull();

    expect(refund).not.toHaveBeenCalled();
  });

  it('recalculates the refund at confirmation time when a tier boundary passes', async () => {
    const booking = await seed();
    at('2027-03-03T08:00:00.000Z');
    expect((await service.refundPreview(booking.id, USER)).percent).toBe(80);

    at('2027-03-03T08:00:00.001Z'); // the user takes a moment to confirm

    expect(
      (await service.cancel(booking.id, USER)).cancellation.refundPercent,
    ).toBe(50);
  });

  it.each([
    ['exactly at departure', '2027-03-10T08:00:00.000Z', false],
    ['after departure', '2027-03-10T09:00:00.000Z', false],
    [
      'after the outbound left, return still ahead',
      '2027-03-12T00:00:00.000Z',
      true,
    ],
  ])('blocks preview and cancellation %s', async (_label, now, roundTrip) => {
    const booking = await seed({ roundTrip });
    at(now);

    for (const action of ['refundPreview', 'cancel'] as const) {
      await expect(service[action](booking.id, USER)).rejects.toMatchObject({
        status: 409,
        response: { code: ErrorCode.InvalidStatusTransition },
      });
    }
    expect((await find(booking.id))?.status).toBe('confirmed');
    expect(counters(OUT, OUT_ECO)).toMatchObject({ bookedSeats: 2 });
    expect(payments.refunds).toHaveLength(0);
    expect(events.emitted).toHaveLength(0);
  });

  it.each(['pending_payment', 'completed', 'expired', 'cancelled'] as const)(
    'rejects a %s booking for both operations without side effects',
    async (status) => {
      const booking = await seed({ status });

      for (const action of ['refundPreview', 'cancel'] as const) {
        await expect(service[action](booking.id, USER)).rejects.toMatchObject({
          status: 409,
          response: { code: ErrorCode.InvalidStatusTransition },
        });
      }
      expect((await find(booking.id))?.status).toBe(status);
      expect(payments.refunds).toHaveLength(0);
      expect(events.emitted).toHaveLength(0);
    },
  );

  it.each(['refundPreview', 'cancel'] as const)(
    '%s hides missing, malformed and other users’ bookings',
    async (action) => {
      const booking = await seed();

      for (const [id, user] of [
        [booking.id, new Types.ObjectId().toHexString()],
        [new Types.ObjectId().toHexString(), USER],
        ['not-an-id', USER],
        [booking.id, 'not-an-id'],
      ]) {
        await expect(service[action](id, user)).rejects.toMatchObject({
          status: 404,
          response: { code: ErrorCode.NotFound },
        });
      }
      expect((await find(booking.id))?.status).toBe('confirmed');
    },
  );

  it('rolls the status back and emits nothing if returning the seats fails', async () => {
    const booking = await seed();
    const failure = new ConflictException({
      code: ErrorCode.ConcurrentChange,
      message: 'Return failed',
    });
    vi.spyOn(seats, 'returnBooked').mockRejectedValueOnce(failure);

    await expect(service.cancel(booking.id, USER)).rejects.toBe(failure);

    const saved = await find(booking.id);
    expect(saved?.status).toBe('confirmed');
    expect(saved?.cancellation).toBeUndefined();
    expect(counters(OUT, OUT_ECO)).toMatchObject({ bookedSeats: 2 });
    expect(payments.refunds).toHaveLength(0);
    expect(events.emitted).toHaveLength(0);
  });

  it('reports a confirmed booking without a reference, and changes nothing', async () => {
    const booking = await seed({ reference: undefined });

    await expect(service.cancel(booking.id, USER)).rejects.toMatchObject({
      status: 500,
      response: { code: ErrorCode.InternalError },
    });

    expect((await find(booking.id))?.status).toBe('confirmed');
    expect(counters(OUT, OUT_ECO)).toMatchObject({ bookedSeats: 2 });
    expect(payments.refunds).toHaveLength(0);
    expect(events.emitted).toHaveLength(0);
  });

  it('parallel cancellations cancel, return seats, refund and notify exactly once', async () => {
    const booking = await seed();
    const returnBooked = vi.spyOn(seats, 'returnBooked');

    const outcomes = await Promise.allSettled([
      service.cancel(booking.id, USER),
      service.cancel(booking.id, USER),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      status: 409,
      response: { code: ErrorCode.InvalidStatusTransition },
    });
    expect((await find(booking.id))?.status).toBe('cancelled');
    expect(counters(OUT, OUT_ECO)).toMatchObject({
      bookedSeats: 0,
      availableSeats: 50,
    });
    expect(returnBooked).toHaveBeenCalledTimes(1);
    expect(payments.refunds).toHaveLength(1);
    expect(events.payloadsOf(Events.FlightBookingCancelled)).toHaveLength(1);
  });

  it('keeps the cancellation and still notifies if the refund request throws', async () => {
    const booking = await seed();
    const failure = new Error('Payments unavailable');
    vi.spyOn(payments, 'refund').mockRejectedValueOnce(failure);

    await expect(service.cancel(booking.id, USER)).rejects.toBe(failure);

    expect((await find(booking.id))?.status).toBe('cancelled');
    expect(counters(OUT, OUT_ECO)).toMatchObject({ bookedSeats: 0 });
    expect(events.payloadsOf(Events.FlightBookingCancelled)).toHaveLength(1);
  });

  it('returns a recorded failed refund without pretending the cancellation rolled back', async () => {
    const booking = await seed();
    vi.spyOn(payments, 'refund').mockImplementation(async (request) => {
      const refund = await FakePaymentsService.prototype.refund.call(
        payments,
        request,
      );
      payments.setStatus(refund.refundId, 'failed');
      return refund;
    });

    const result = await service.cancel(booking.id, USER);

    expect(result.refund?.status).toBe('failed');
    expect((await find(booking.id))?.status).toBe('cancelled');
  });
});
