import { Types } from 'mongoose';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PayableBookingRegistry } from '../payments/ports/payable-booking.registry.js';
import type { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightHoldService } from './flight-hold.service.js';
import { FlightPayableBooking } from './flight-payable-booking.js';

const AIRLINE = '6553a1f0c2b4e8a9d0f1c001';
const OUT = '6553a1f0c2b4e8a9d0f1c002';
const OUT_ECO = '6553a1f0c2b4e8a9d0f1c003';
const BACK = '6553a1f0c2b4e8a9d0f1c004';
const BACK_ECO = '6553a1f0c2b4e8a9d0f1c005';
const OWNER = '6553a1f0c2b4e8a9d0f1c098';
const SOMEONE_ELSE = '6553a1f0c2b4e8a9d0f1c099';

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({
    id: AIRLINE,
    code: 'MS',
    baggagePolicy: { extraBagPriceMinor: 3_000, maxExtraBagsPerPassenger: 2 },
    cancellationTiers: [
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 30, refundPercent: 100 },
    ],
  });
  const flight = (
    id: string,
    cabinId: string,
    number: string,
    from: string,
    to: string,
    departureAt: Date,
  ) =>
    data.addFlight({
      id,
      airlineId: AIRLINE,
      flightNumber: number,
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
  flight(OUT, OUT_ECO, 'MS100', 'CAI', 'DXB', new Date('2027-03-10T08:00:00Z'));
  flight(
    BACK,
    BACK_ECO,
    'MS101',
    'DXB',
    'CAI',
    new Date('2027-03-17T08:00:00Z'),
  );
  return data;
}

const roundTrip: FlightQuoteRequestDto = {
  tripType: 'round_trip',
  segments: [
    { flightId: OUT, cabinId: OUT_ECO },
    { flightId: BACK, cabinId: BACK_ECO },
  ],
  passengers: [
    {
      type: 'adult',
      fullName: 'Aya Amr',
      dateOfBirth: '1990-01-01',
      documentNumber: 'A1234567',
      extraBagCount: 1,
      extraBagWeightKg: 20,
    },
  ],
};

const NOT_FOUND = { status: 404, response: { code: 'NOT_FOUND' } };

describe('FlightPayableBooking (PAY-01, PAY-02, ACC-11)', () => {
  let t: TestApp;
  let holds: FlightHoldService;
  let payable: FlightPayableBooking;
  const flights = new FakeFlightsService();
  const seats = new FakeSeatInventory();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(flights)
          .overrideProvider(SeatInventory)
          .useValue(seats),
    });
    holds = t.moduleRef.get(FlightHoldService);
    payable = t.moduleRef.get(FlightPayableBooking);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    const data = seedFlights();
    Object.assign(flights, new FakeFlightsService(data));
    Object.assign(seats, new FakeSeatInventory(data));
    await clearCollections(t.connection);
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('registers itself as the flight PayableBooking at startup', () => {
    const registry = t.moduleRef.get(PayableBookingRegistry);
    expect(registry.get('flight')).toBe(payable);
    expect(payable.bookingType).toBe('flight');
  });

  it('returns the amount, currency, status and hold expiry to the owner', async () => {
    const hold = await holds.hold(roundTrip, OWNER);

    await expect(payable.getPayable(hold.bookingId, OWNER)).resolves.toEqual({
      amountMinor: hold.pricing.totalMinor,
      currency: 'USD',
      status: 'pending_payment',
      holdExpiresAt: hold.holdExpiresAt,
    });
  });

  it('returns every segment’s policy snapshot to the owner', async () => {
    const hold = await holds.hold(roundTrip, OWNER);

    const policies = await payable.getPolicies(hold.bookingId, OWNER);
    expect(policies).toEqual({
      bookingType: 'flight',
      segments: [
        {
          direction: 'outbound',
          flightNumber: 'MS100',
          cancellationTiers: [
            { daysBefore: 7, refundPercent: 50 },
            { daysBefore: 30, refundPercent: 100 },
          ],
          freeBags: 1,
          maxBagWeightKg: 23,
          extraBagPriceMinor: 3_000,
          maxExtraBagsPerPassenger: 2,
        },
        expect.objectContaining({ direction: 'return', flightNumber: 'MS101' }),
      ],
    });
  });

  // ACC-11: someone else's booking looks exactly like one that doesn't exist.
  describe.each(['getPayable', 'getPolicies'] as const)('%s', (method) => {
    it('answers 404 for another user’s booking', async () => {
      const hold = await holds.hold(roundTrip, OWNER);
      await expect(
        payable[method](hold.bookingId, SOMEONE_ELSE),
      ).rejects.toMatchObject(NOT_FOUND);
    });

    it('answers 404 for an unknown booking', async () => {
      await expect(
        payable[method](new Types.ObjectId().toHexString(), OWNER),
      ).rejects.toMatchObject(NOT_FOUND);
    });

    it('answers 404, not 500, for a malformed id', async () => {
      await expect(payable[method]('not-an-id', OWNER)).rejects.toMatchObject(
        NOT_FOUND,
      );
    });
  });
});
