import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
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
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightCancellationService } from './flight-cancellation.service.js';
import { FlightChangeExpiryJob } from './flight-change-expiry.job.js';
import { FlightChangeService } from './flight-change.service.js';
import { FlightPayableBooking } from './flight-payable-booking.js';
import { FlightProviderCancellationService } from './flight-provider-cancellation.service.js';
import { FlightRescheduleSyncService } from './flight-reschedule-sync.service.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

const AIRLINE = '6553a1f0c2b4e8a9d0f1f001';
/** The booked flight, CAI → DXB, 20 000 per seat. */
const FLIGHT = '6553a1f0c2b4e8a9d0f1f002';
const CABIN = '6553a1f0c2b4e8a9d0f1f003';
/** Same route a day later, 25 000 per seat: a paid change. */
const LATER = '6553a1f0c2b4e8a9d0f1f004';
const LATER_CABIN = '6553a1f0c2b4e8a9d0f1f005';
const USER = '6553a1f0c2b4e8a9d0f1f098';
const SOMEONE_ELSE = '6553a1f0c2b4e8a9d0f1f099';
const NOW = new Date('2027-03-01T00:00:00.000Z');
const DEPARTS = new Date('2027-03-10T08:00:00.000Z');
const LATER_DEPARTS = new Date('2027-03-11T08:00:00.000Z');
const HOUR = 3_600_000;
const TIERS = [{ daysBefore: 3, refundPercent: 50 }];

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS', cancellationTiers: TIERS });
  data.addFlight({
    id: FLIGHT,
    airlineId: AIRLINE,
    flightNumber: 'MS002',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAt: DEPARTS,
    arrivalAt: new Date(DEPARTS.getTime() + 4 * HOUR),
    // The booking's 2 seats are booked.
    cabins: [
      {
        id: CABIN,
        cabinClass: 'economy',
        totalSeats: 50,
        availableSeats: 48,
        bookedSeats: 2,
        priceMinor: 20_000,
      },
    ],
  });
  data.addFlight({
    id: LATER,
    airlineId: AIRLINE,
    flightNumber: 'MS004',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAt: LATER_DEPARTS,
    arrivalAt: new Date(LATER_DEPARTS.getTime() + 4 * HOUR),
    cabins: [
      {
        id: LATER_CABIN,
        cabinClass: 'economy',
        totalSeats: 50,
        priceMinor: 25_000,
      },
    ],
  });
  return data;
}

describe('a flight change after it is requested (FLT-27)', () => {
  let t: TestApp;
  let bookings: Model<FlightBooking>;
  let changes: FlightChangeService;
  let emitter: EventEmitter2;
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
    bookings = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    changes = t.moduleRef.get(FlightChangeService);
    emitter = t.moduleRef.get(EventEmitter2);
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

  afterEach(() => vi.useRealTimers());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  /** A confirmed one-way booking for two adults on FLIGHT, paid 40 000. */
  async function seed() {
    const passenger = (fullName: string) => ({
      type: 'adult' as const,
      fullName,
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      documentNumber: 'A1234567',
      extraBagCount: 0,
    });
    return bookings.create({
      userId: USER,
      reference: 'FBLIF001',
      status: 'confirmed',
      tripType: 'one_way',
      segments: [
        {
          direction: 'outbound',
          flightId: FLIGHT,
          cabinId: CABIN,
          cabinClass: 'economy',
          airlineId: AIRLINE,
          flightNumber: 'MS002',
          departureAirportId: 'CAI',
          arrivalAirportId: 'DXB',
          departureAt: DEPARTS,
          arrivalAt: new Date(DEPARTS.getTime() + 4 * HOUR),
          fareMinor: 20_000,
          policy: {
            cancellationTiers: TIERS,
            freeBags: 1,
            maxBagWeightKg: 23,
            extraBagPriceMinor: 0,
            maxExtraBagsPerPassenger: 0,
          },
        },
      ],
      passengers: [passenger('Aya Amr'), passenger('Jana Test')],
      seatCount: 2,
      pricing: {
        fareTotalMinor: 40_000,
        baggageTotalMinor: 0,
        totalMinor: 40_000,
        currency: 'USD',
      },
      holdExpiresAt: new Date('2027-02-20T00:10:00.000Z'),
      firstDepartureAt: DEPARTS,
      lastDepartureAt: DEPARTS,
    });
  }

  /** Seeds the booking and requests the paid change to LATER (10 000 to pay). */
  async function withPendingChange() {
    const booking = await seed();
    const requested = await changes.change(booking.id, USER, {
      direction: 'outbound',
      flightId: LATER,
      acceptPolicies: true,
    });
    expect(requested.applied).toBe(false);
    return { bookingId: booking.id, changeId: requested.changeId };
  }

  const pay = (bookingId: string, changeId: string) =>
    emitter.emitAsync(Events.PaymentSucceeded, {
      bookingType: 'flight',
      bookingId,
      changeId,
    });

  const stored = (bookingId: string) => bookings.findById(bookingId).lean();
  const changeExpired = () =>
    events.payloadsOf(Events.FlightBookingChangeExpired);

  describe('payment (PAY-01)', () => {
    it('getPayable returns the waiting change to its owner, and 404 otherwise', async () => {
      const { bookingId, changeId } = await withPendingChange();
      const payable = t.moduleRef.get(FlightPayableBooking);

      await expect(
        payable.getPayable(bookingId, USER, changeId),
      ).resolves.toEqual({
        amountMinor: 10_000,
        currency: 'USD',
        status: 'pending_payment',
        holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
      });
      for (const [user, change] of [
        [SOMEONE_ELSE, changeId],
        [USER, new Types.ObjectId().toHexString()],
        [USER, 'not-an-id'],
      ]) {
        await expect(
          payable.getPayable(bookingId, user, change),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
    });

    it('applies a paid change: moves the seats, updates the booking in place and keeps the history', async () => {
      const { bookingId, changeId } = await withPendingChange();

      await pay(bookingId, changeId);

      const booking = await stored(bookingId);
      expect(booking?.status).toBe('confirmed');
      expect(booking?.reference).toBe('FBLIF001');
      expect(booking?.pendingChange).toBeUndefined();
      expect(booking?.segments[0]?.flightId.toString()).toBe(LATER);
      expect(booking?.segments[0]?.fareMinor).toBe(25_000);
      expect(booking?.pricing.totalMinor).toBe(50_000);
      expect(booking?.firstDepartureAt).toEqual(LATER_DEPARTS);
      expect(booking?.lastDepartureAt).toEqual(LATER_DEPARTS);
      expect(booking?.changes).toHaveLength(1);
      expect(booking?.changes?.[0]?._id.toString()).toBe(changeId);
      expect(booking?.changes?.[0]).toMatchObject({
        previousTotalMinor: 40_000,
        newTotalMinor: 50_000,
        differenceMinor: 10_000,
      });
      expect(seats.counters(LATER, LATER_CABIN)).toMatchObject({
        heldSeats: 0,
        bookedSeats: 2,
      });
      expect(seats.counters(FLIGHT, CABIN)).toMatchObject({
        bookedSeats: 0,
        availableSeats: 50,
      });
      // The booking confirmation (FLT-23) ignores a change's payment.
      expect(payments.refunds).toHaveLength(0);
      expect(changeExpired()).toEqual([]);
    });

    it('applies it once when the event arrives twice', async () => {
      const { bookingId, changeId } = await withPendingChange();

      await pay(bookingId, changeId);
      await pay(bookingId, changeId);

      expect((await stored(bookingId))?.changes).toHaveLength(1);
      expect(seats.counters(LATER, LATER_CABIN)?.bookedSeats).toBe(2);
      expect(changeExpired()).toEqual([]);
    });

    it('asks payments to refund a change paid after it was dropped (late payment)', async () => {
      const { bookingId, changeId } = await withPendingChange();
      const job = t.moduleRef.get(FlightChangeExpiryJob);
      await job.expireDueChanges(new Date(NOW.getTime() + 10 * 60_000));
      expect(changeExpired()).toEqual([{ bookingId, userId: USER, changeId }]);
      events.clear();

      await pay(bookingId, changeId);

      // Payments refunds a succeeded change payment in full when told again.
      expect(changeExpired()).toEqual([{ bookingId, userId: USER, changeId }]);
      const booking = await stored(bookingId);
      expect(booking?.segments[0]?.flightId.toString()).toBe(FLIGHT);
      expect(booking?.changes).toBeUndefined();
    });

    it('drops the change and asks for a refund when the new flight left the schedule before the payment', async () => {
      const { bookingId, changeId } = await withPendingChange();
      seats.data.flight(LATER)!.status = 'cancelled';

      await pay(bookingId, changeId);

      const booking = await stored(bookingId);
      expect(booking?.pendingChange).toBeUndefined();
      expect(booking?.segments[0]?.flightId.toString()).toBe(FLIGHT);
      expect(seats.counters(LATER, LATER_CABIN)?.heldSeats).toBe(0);
      expect(seats.counters(FLIGHT, CABIN)?.bookedSeats).toBe(2);
      expect(changeExpired()).toEqual([{ bookingId, userId: USER, changeId }]);
    });
  });

  describe('cancellation (FLT-26, FLT-06)', () => {
    it('a user cancellation drops the waiting change: releases its seats and tells payments', async () => {
      const { bookingId, changeId } = await withPendingChange();

      await t.moduleRef.get(FlightCancellationService).cancel(bookingId, USER);

      const booking = await stored(bookingId);
      expect(booking?.status).toBe('cancelled');
      expect(booking?.pendingChange).toBeUndefined();
      expect(seats.counters(LATER, LATER_CABIN)?.heldSeats).toBe(0);
      expect(seats.counters(FLIGHT, CABIN)?.bookedSeats).toBe(0);
      expect(changeExpired()).toEqual([{ bookingId, userId: USER, changeId }]);
    });

    it('cancelling after a paid change refunds both payments by the same percent', async () => {
      const { bookingId, changeId } = await withPendingChange();
      await pay(bookingId, changeId);

      const result = await t.moduleRef
        .get(FlightCancellationService)
        .cancel(bookingId, USER);

      // 10 days before departure: 50% of 50 000 = 25 000.
      expect(result.cancellation.refundAmountMinor).toBe(25_000);
      const byChange = payments.refunds.map((r) => ({
        amountMinor: r.amountMinor,
        changeId: payments.changeIds.get(r.refundId),
      }));
      expect(byChange).toEqual(
        expect.arrayContaining([
          { amountMinor: 20_000, changeId: undefined },
          { amountMinor: 5_000, changeId },
        ]),
      );
      expect(byChange).toHaveLength(2);
      expect(result.refund?.amountMinor).toBe(20_000);
    });

    it('a provider cancelling the waiting change’s new flight drops only the change', async () => {
      const { bookingId, changeId } = await withPendingChange();

      await t.moduleRef
        .get(FlightProviderCancellationService)
        .cancelBookingsOf(LATER, NOW);

      const booking = await stored(bookingId);
      expect(booking?.status).toBe('confirmed');
      expect(booking?.pendingChange).toBeUndefined();
      expect(booking?.segments[0]?.flightId.toString()).toBe(FLIGHT);
      expect(seats.counters(LATER, LATER_CABIN)?.heldSeats).toBe(0);
      expect(changeExpired()).toEqual([{ bookingId, userId: USER, changeId }]);
      expect(payments.refunds).toHaveLength(0);
    });

    it('a provider cancelling the booked flight also drops the waiting change', async () => {
      const { bookingId, changeId } = await withPendingChange();

      await t.moduleRef
        .get(FlightProviderCancellationService)
        .cancelBookingsOf(FLIGHT, NOW);

      const booking = await stored(bookingId);
      expect(booking?.status).toBe('cancelled');
      expect(booking?.pendingChange).toBeUndefined();
      expect(seats.counters(LATER, LATER_CABIN)?.heldSeats).toBe(0);
      expect(changeExpired()).toEqual([{ bookingId, userId: USER, changeId }]);
      expect(payments.refunds.map((r) => r.amountMinor)).toEqual([40_000]);
    });

    it('a provider cancellation after a paid change refunds both payments in full', async () => {
      const { bookingId, changeId } = await withPendingChange();
      await pay(bookingId, changeId);

      await t.moduleRef
        .get(FlightProviderCancellationService)
        .cancelBookingsOf(LATER, NOW);

      const byChange = payments.refunds.map((r) => ({
        amountMinor: r.amountMinor,
        changeId: payments.changeIds.get(r.refundId),
      }));
      expect(byChange).toEqual(
        expect.arrayContaining([
          { amountMinor: 40_000, changeId: undefined },
          { amountMinor: 10_000, changeId },
        ]),
      );
      expect(byChange).toHaveLength(2);
    });
  });

  it('a reschedule of the waiting change’s new flight updates its times (FLT-05)', async () => {
    const { bookingId } = await withPendingChange();
    const departureAt = new Date('2027-03-11T10:00:00.000Z');
    const arrivalAt = new Date('2027-03-11T14:00:00.000Z');

    await t.moduleRef
      .get(FlightRescheduleSyncService)
      .sync({ flightId: LATER, departureAt, arrivalAt });

    const booking = await stored(bookingId);
    expect(booking?.pendingChange?.segment.departureAt).toEqual(departureAt);
    expect(booking?.pendingChange?.segment.arrivalAt).toEqual(arrivalAt);
  });
});
