import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../src/common/dates/date-only.js';
import { getPlatformCurrency } from '../../src/common/money/platform-currency.js';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../../src/modules/flight-bookings/schemas/flight-booking.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

const OUTBOUND_AT = new Date('2027-03-01T08:00:00.000Z');
const RETURN_AT = new Date('2027-03-08T18:00:00.000Z');

function policyDoc(overrides: Record<string, unknown> = {}) {
  return {
    cancellationTiers: [
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 30, refundPercent: 90 },
    ],
    freeBags: 1,
    maxBagWeightKg: 23,
    extraBagPriceMinor: 3_000,
    maxExtraBagsPerPassenger: 2,
    ...overrides,
  };
}

function segmentDoc(
  direction: 'outbound' | 'return',
  overrides: Record<string, unknown> = {},
) {
  const outbound = direction === 'outbound';
  const departureAt = outbound ? OUTBOUND_AT : RETURN_AT;
  return {
    direction,
    flightId: new Types.ObjectId(),
    cabinId: new Types.ObjectId(),
    cabinClass: 'economy' as const,
    airlineId: new Types.ObjectId(),
    flightNumber: outbound ? 'MS985' : 'MS986',
    departureAirportId: outbound ? 'CAI' : 'JFK',
    arrivalAirportId: outbound ? 'JFK' : 'CAI',
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 12 * 60 * 60_000),
    fareMinor: 15_000,
    policy: policyDoc(),
    ...overrides,
  };
}

const DATE_OF_BIRTH = {
  adult: '1990-05-20',
  child: '2020-02-14',
  infant: '2026-06-01',
} as const;

function passengerDoc(
  type: 'adult' | 'child' | 'infant' = 'adult',
  overrides: Record<string, unknown> = {},
) {
  return {
    type,
    fullName: 'Mona Adel',
    dateOfBirth: toDateOnly(DATE_OF_BIRTH[type]),
    documentNumber: 'A12345678',
    extraBagCount: 0,
    ...overrides,
  };
}

function bookingDoc(overrides: Record<string, unknown> = {}) {
  return {
    userId: new Types.ObjectId(),
    status: 'pending_payment' as const,
    tripType: 'one_way' as const,
    segments: [segmentDoc('outbound')],
    passengers: [passengerDoc('adult')],
    seatCount: 1,
    pricing: {
      fareTotalMinor: 15_000,
      baggageTotalMinor: 0,
      totalMinor: 15_000,
      currency: getPlatformCurrency(),
    },
    holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    firstDepartureAt: OUTBOUND_AT,
    lastDepartureAt: OUTBOUND_AT,
    ...overrides,
  };
}

function roundTripDoc(overrides: Record<string, unknown> = {}) {
  return bookingDoc({
    tripType: 'round_trip',
    segments: [segmentDoc('outbound'), segmentDoc('return')],
    lastDepartureAt: RETURN_AT,
    ...overrides,
  });
}

describe('flight-bookings schemas', () => {
  let db: TestDatabase;
  let bookings: Model<FlightBooking>;

  beforeAll(async () => {
    db = await startTestDatabase('flight-bookings');
    bookings = db.connection.model<FlightBooking>(
      FlightBooking.name,
      FlightBookingSchema,
    );
    await bookings.init();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await bookings.deleteMany({});
  });

  it('uses the flight_bookings collection', () => {
    expect(bookings.collection.collectionName).toBe('flight_bookings');
  });

  it('saves a valid one-way and round-trip booking with no defaults added', async () => {
    const oneWay = await bookings.create(bookingDoc());
    expect(oneWay.reference).toBeUndefined();
    expect(oneWay.confirmedAt).toBeUndefined();
    expect(oneWay.expiredAt).toBeUndefined();
    expect(oneWay.completedAt).toBeUndefined();
    expect(oneWay.cancellation).toBeUndefined();
    expect(oneWay.pricing.currency).toBe(getPlatformCurrency());
    expect(oneWay.segments[0]).toHaveProperty('_id');
    expect(oneWay.passengers[0]).toHaveProperty('_id');
    expect(oneWay.get('createdAt')).toBeInstanceOf(Date);

    const roundTrip = await bookings.create(roundTripDoc());
    expect(roundTrip.segments.map((segment) => segment.direction)).toEqual([
      'outbound',
      'return',
    ]);
  });

  it('requires the status, with no default', async () => {
    await expect(
      new bookings(bookingDoc({ status: undefined })).validate(),
    ).rejects.toThrow(/status/);
    await expect(
      new bookings(bookingDoc({ status: 'held' })).validate(),
    ).rejects.toThrow(/status/);
    await expect(
      new bookings(bookingDoc({ status: 'confirmed' })).validate(),
    ).resolves.toBeUndefined();
  });

  it('validates the reference format', async () => {
    for (const reference of ['FB12345', 'fb123456', 'XX123456', 'FB1234567']) {
      await expect(
        new bookings(bookingDoc({ reference })).validate(),
      ).rejects.toThrow(/reference/);
    }
    await expect(
      new bookings(bookingDoc({ reference: 'FBA1B2C3' })).validate(),
    ).resolves.toBeUndefined();
  });

  it('allows many bookings without a reference but no duplicate reference', async () => {
    await bookings.create(bookingDoc());
    await expect(bookings.create(bookingDoc())).resolves.toBeDefined();

    await bookings.create(bookingDoc({ reference: 'FBA1B2C3' }));
    await expect(
      bookings.create(bookingDoc({ reference: 'FBA1B2C3' })),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      bookings.create(bookingDoc({ reference: 'FBZZZ999' })),
    ).resolves.toBeDefined();
  });

  it('rejects zero or three segments', async () => {
    await expect(
      new bookings(bookingDoc({ segments: [] })).validate(),
    ).rejects.toThrow(/segments/);
    await expect(
      new bookings(
        roundTripDoc({
          segments: [
            segmentDoc('outbound'),
            segmentDoc('return'),
            segmentDoc('return'),
          ],
        }),
      ).validate(),
    ).rejects.toThrow(/segments/);
    await expect(
      new bookings(roundTripDoc()).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects segments that do not match the trip type', async () => {
    const mismatches = [
      roundTripDoc({ segments: [segmentDoc('outbound')] }),
      roundTripDoc({
        segments: [segmentDoc('return'), segmentDoc('outbound')],
      }),
      roundTripDoc({
        segments: [segmentDoc('outbound'), segmentDoc('outbound')],
      }),
      bookingDoc({ segments: [segmentDoc('outbound'), segmentDoc('return')] }),
      bookingDoc({ segments: [segmentDoc('return')] }),
    ];
    for (const doc of mismatches) {
      await expect(new bookings(doc).validate()).rejects.toThrow(
        /segments must match tripType/,
      );
    }
    await expect(
      new bookings(bookingDoc()).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new bookings(roundTripDoc()).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects duplicate daysBefore in a segment policy', async () => {
    await expect(
      new bookings(
        bookingDoc({
          segments: [
            segmentDoc('outbound', {
              policy: policyDoc({
                cancellationTiers: [
                  { daysBefore: 7, refundPercent: 50 },
                  { daysBefore: 7, refundPercent: 90 },
                ],
              }),
            }),
          ],
        }),
      ).validate(),
    ).rejects.toThrow(/daysBefore/);
    await expect(
      new bookings(
        bookingDoc({
          segments: [
            segmentDoc('outbound', {
              policy: policyDoc({ cancellationTiers: [] }),
            }),
          ],
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('validates segment policy numbers', async () => {
    const invalid = [
      { maxBagWeightKg: 0 },
      { freeBags: -1 },
      { extraBagPriceMinor: -1 },
      { maxExtraBagsPerPassenger: 1.5 },
    ];
    for (const overrides of invalid) {
      await expect(
        new bookings(
          bookingDoc({
            segments: [
              segmentDoc('outbound', { policy: policyDoc(overrides) }),
            ],
          }),
        ).validate(),
      ).rejects.toThrow(/segments\.0\.policy\./);
    }
    await expect(
      new bookings(
        bookingDoc({
          segments: [
            segmentDoc('outbound', {
              policy: policyDoc({
                extraBagPriceMinor: 0,
                maxExtraBagsPerPassenger: 0,
              }),
            }),
          ],
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('requires at least one passenger', async () => {
    await expect(
      new bookings(bookingDoc({ passengers: [], seatCount: 0 })).validate(),
    ).rejects.toThrow(/passengers must have at least 1 item/);
    await expect(
      new bookings(
        bookingDoc({ passengers: [passengerDoc('adult')], seatCount: 1 }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects a booking without an adult', async () => {
    await expect(
      new bookings(
        bookingDoc({ passengers: [passengerDoc('child')], seatCount: 1 }),
      ).validate(),
    ).rejects.toThrow(/at least one adult/);
    await expect(
      new bookings(
        bookingDoc({
          passengers: [passengerDoc('adult'), passengerDoc('child')],
          seatCount: 2,
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects more infants than adults', async () => {
    await expect(
      new bookings(
        bookingDoc({
          passengers: [
            passengerDoc('adult'),
            passengerDoc('infant'),
            passengerDoc('infant'),
          ],
          seatCount: 1,
        }),
      ).validate(),
    ).rejects.toThrow(/more infants than adults/);
    await expect(
      new bookings(
        bookingDoc({
          passengers: [
            passengerDoc('adult'),
            passengerDoc('adult'),
            passengerDoc('infant'),
            passengerDoc('infant'),
          ],
          seatCount: 2,
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('requires seatCount to equal adults plus children', async () => {
    const passengers = [
      passengerDoc('adult'),
      passengerDoc('child'),
      passengerDoc('infant'),
    ];
    for (const seatCount of [1, 3]) {
      await expect(
        new bookings(bookingDoc({ passengers, seatCount })).validate(),
      ).rejects.toThrow(/seatCount must equal/);
    }
    await expect(
      new bookings(bookingDoc({ passengers, seatCount: 2 })).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects extra bags above the max of any segment', async () => {
    const segments = [
      segmentDoc('outbound', {
        policy: policyDoc({ maxExtraBagsPerPassenger: 3 }),
      }),
      segmentDoc('return', {
        policy: policyDoc({ maxExtraBagsPerPassenger: 1 }),
      }),
    ];
    await expect(
      new bookings(
        roundTripDoc({
          segments,
          passengers: [
            passengerDoc('adult', { extraBagCount: 2, extraBagWeightKg: 20 }),
          ],
        }),
      ).validate(),
    ).rejects.toThrow(/extraBagCount must not exceed/);
    await expect(
      new bookings(
        roundTripDoc({
          segments,
          passengers: [
            passengerDoc('adult', { extraBagCount: 1, extraBagWeightKg: 20 }),
          ],
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects an extra bag weight above the max of any segment', async () => {
    const segments = [
      segmentDoc('outbound', { policy: policyDoc({ maxBagWeightKg: 32 }) }),
      segmentDoc('return', { policy: policyDoc({ maxBagWeightKg: 23 }) }),
    ];
    await expect(
      new bookings(
        roundTripDoc({
          segments,
          passengers: [
            passengerDoc('adult', { extraBagCount: 1, extraBagWeightKg: 25 }),
          ],
        }),
      ).validate(),
    ).rejects.toThrow(/extraBagWeightKg must not exceed/);
    await expect(
      new bookings(
        roundTripDoc({
          segments,
          passengers: [
            passengerDoc('adult', { extraBagCount: 1, extraBagWeightKg: 23 }),
          ],
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('requires a positive extra bag weight when extra bags are booked', async () => {
    for (const extraBagWeightKg of [undefined, 0]) {
      await expect(
        new bookings(
          bookingDoc({
            passengers: [
              passengerDoc('adult', { extraBagCount: 1, extraBagWeightKg }),
            ],
          }),
        ).validate(),
      ).rejects.toThrow(/extraBagWeightKg/);
    }
    await expect(
      new bookings(
        bookingDoc({
          passengers: [passengerDoc('adult', { extraBagCount: 0 })],
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('validates passenger fields', async () => {
    const invalid = [
      { type: 'senior' },
      { fullName: '  ' },
      { fullName: 'x'.repeat(101) },
      { documentNumber: 'AB' },
      { documentNumber: 'x'.repeat(31) },
      { dateOfBirth: new Date('1990-05-20T10:00:00.000Z') },
      { extraBagCount: -1 },
      { extraBagCount: undefined },
    ];
    for (const overrides of invalid) {
      await expect(
        new bookings(
          bookingDoc({ passengers: [passengerDoc('adult', overrides)] }),
        ).validate(),
      ).rejects.toThrow(/passengers\.0\./);
    }
    await expect(
      new bookings(
        bookingDoc({
          passengers: [
            passengerDoc('adult', {
              fullName: 'x'.repeat(100),
              documentNumber: 'ABC',
            }),
          ],
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('defaults pricing.currency to the platform currency when it is not given', async () => {
    const pricing = bookingDoc().pricing;
    const booking = await bookings.create(
      bookingDoc({ pricing: { ...pricing, currency: undefined } }),
    );
    expect(booking.pricing.currency).toBe(getPlatformCurrency());
    const stored = await bookings.collection.findOne({ _id: booking._id });
    expect(stored?.pricing.currency).toBe(getPlatformCurrency());
    await expect(
      new bookings(
        bookingDoc({ pricing: { ...pricing, currency: '' } }),
      ).validate(),
    ).rejects.toThrow(/pricing\.currency.*required/);
  });

  it('validates pricing amounts', async () => {
    const pricing = bookingDoc().pricing;
    const invalid = [
      { ...pricing, fareTotalMinor: -1 },
      { ...pricing, baggageTotalMinor: 10.5 },
      { ...pricing, totalMinor: undefined },
    ];
    for (const value of invalid) {
      await expect(
        new bookings(bookingDoc({ pricing: value })).validate(),
      ).rejects.toThrow(/pricing\./);
    }
  });

  it('accepts a cancellation', async () => {
    await expect(
      new bookings(
        bookingDoc({
          status: 'cancelled',
          cancellation: {
            cancelledAt: new Date(),
            cancelledBy: 'user',
            refundPercent: 50,
            refundAmountMinor: 7_500,
          },
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('has exactly the indexes from the data model', async () => {
    const indexes = await bookings.collection.indexes();
    expect(
      indexes.map((index) => ({
        key: index.key,
        unique: index.unique ?? false,
        partialFilterExpression: index.partialFilterExpression,
      })),
    ).toEqual(
      expect.arrayContaining([
        { key: { _id: 1 }, unique: false, partialFilterExpression: undefined },
        {
          key: { reference: 1 },
          unique: true,
          partialFilterExpression: { reference: { $type: 'string' } },
        },
        {
          key: { userId: 1, firstDepartureAt: -1 },
          unique: false,
          partialFilterExpression: undefined,
        },
        {
          key: { 'segments.flightId': 1, status: 1 },
          unique: false,
          partialFilterExpression: undefined,
        },
        {
          key: { status: 1, holdExpiresAt: 1 },
          unique: false,
          partialFilterExpression: undefined,
        },
        {
          key: { status: 1, lastDepartureAt: 1 },
          unique: false,
          partialFilterExpression: undefined,
        },
        {
          key: { status: 1, createdAt: -1 },
          unique: false,
          partialFilterExpression: undefined,
        },
      ]),
    );
    expect(indexes).toHaveLength(7);
  });
});
