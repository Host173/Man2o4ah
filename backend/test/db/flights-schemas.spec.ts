import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  Airline,
  AirlineSchema,
} from '../../src/modules/flights/schemas/airline.schema.js';
import {
  Flight,
  FlightSchema,
} from '../../src/modules/flights/schemas/flight.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

function airlineDoc(overrides: Record<string, unknown> = {}) {
  return { name: 'EgyptAir', code: 'MS', ...overrides };
}

function cabinDoc(overrides: Record<string, unknown> = {}) {
  return {
    cabinClass: 'economy',
    totalSeats: 100,
    availableSeats: 90,
    heldSeats: 4,
    bookedSeats: 6,
    priceMinor: 15_000,
    freeBags: 1,
    maxBagWeightKg: 23,
    ...overrides,
  };
}

const AIRLINE_ID = new Types.ObjectId();

function flightDoc(overrides: Record<string, unknown> = {}) {
  return {
    airlineId: AIRLINE_ID,
    flightNumber: 'MS985',
    departureAirportId: 'CAI',
    arrivalAirportId: 'JFK',
    departureAt: new Date('2027-01-10T08:00:00.000Z'),
    arrivalAt: new Date('2027-01-10T20:00:00.000Z'),
    departureLocalDate: '2027-01-10',
    durationMinutes: 720,
    cabins: [cabinDoc()],
    ...overrides,
  };
}

describe('flights schemas', () => {
  let db: TestDatabase;
  let airlines: Model<Airline>;
  let flights: Model<Flight>;

  beforeAll(async () => {
    db = await startTestDatabase('flights');
    airlines = db.connection.model(Airline.name, AirlineSchema);
    flights = db.connection.model(Flight.name, FlightSchema);
    await airlines.init();
    await flights.init();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await airlines.deleteMany({});
    await flights.deleteMany({});
  });

  describe('airlines', () => {
    it('uses the airlines collection', () => {
      expect(airlines.collection.collectionName).toBe('airlines');
    });

    it('applies defaults', async () => {
      const airline = await airlines.create(airlineDoc());
      expect(airline.isActive).toBe(true);
      expect(airline.baggagePolicy).toMatchObject({
        extraBagPriceMinor: null,
        maxExtraBagsPerPassenger: 0,
      });
      expect(airline.cancellationPolicy.tiers).toHaveLength(0);
      expect(airline.logo).toBeUndefined();
      expect(airline.createdAt).toBeInstanceOf(Date);
    });

    it('uppercases the code and validates its format', async () => {
      const airline = await airlines.create(airlineDoc({ code: 'ms' }));
      expect(airline.code).toBe('MS');
      for (const code of ['M', 'MSRX', 'M-1']) {
        await expect(
          new airlines(airlineDoc({ code })).validate(),
        ).rejects.toThrow(/code/);
      }
      await expect(
        new airlines(airlineDoc({ code: 'J9X' })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a duplicate code', async () => {
      await airlines.create(airlineDoc({ code: 'MS' }));
      await expect(
        airlines.create(airlineDoc({ code: 'MS' })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        airlines.create(airlineDoc({ code: 'SV' })),
      ).resolves.toBeDefined();
    });

    it('validates name length after trimming', async () => {
      await expect(
        new airlines(airlineDoc({ name: '  ' })).validate(),
      ).rejects.toThrow(/name/);
      await expect(
        new airlines(airlineDoc({ name: 'x'.repeat(101) })).validate(),
      ).rejects.toThrow(/name/);
      await expect(
        new airlines(airlineDoc({ name: 'x'.repeat(100) })).validate(),
      ).resolves.toBeUndefined();
    });

    it('accepts one logo', async () => {
      const airline = await airlines.create(
        airlineDoc({ logo: { key: 'ms-logo.png' } }),
      );
      expect(airline.logo?.key).toBe('ms-logo.png');
    });

    it('requires an extra bag price when extra bags are allowed', async () => {
      for (const extraBagPriceMinor of [null, undefined]) {
        await expect(
          new airlines(
            airlineDoc({
              baggagePolicy: {
                extraBagPriceMinor,
                maxExtraBagsPerPassenger: 2,
              },
            }),
          ).validate(),
        ).rejects.toThrow(/extraBagPriceMinor/);
      }
      await expect(
        new airlines(
          airlineDoc({
            baggagePolicy: {
              extraBagPriceMinor: 2_500,
              maxExtraBagsPerPassenger: 2,
            },
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('requires the extra bag price to be a positive integer or null', async () => {
      for (const extraBagPriceMinor of [0, 12.5]) {
        await expect(
          new airlines(
            airlineDoc({
              baggagePolicy: {
                extraBagPriceMinor,
                maxExtraBagsPerPassenger: 1,
              },
            }),
          ).validate(),
        ).rejects.toThrow(/extraBagPriceMinor/);
      }
      await expect(
        new airlines(
          airlineDoc({
            baggagePolicy: {
              extraBagPriceMinor: null,
              maxExtraBagsPerPassenger: 0,
            },
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a negative or fractional maxExtraBagsPerPassenger', async () => {
      for (const maxExtraBagsPerPassenger of [-1, 1.5]) {
        await expect(
          new airlines(
            airlineDoc({
              baggagePolicy: {
                extraBagPriceMinor: 2_500,
                maxExtraBagsPerPassenger,
              },
            }),
          ).validate(),
        ).rejects.toThrow(/maxExtraBagsPerPassenger/);
      }
    });

    it('rejects duplicate daysBefore in the cancellation tiers', async () => {
      await expect(
        new airlines(
          airlineDoc({
            cancellationPolicy: {
              tiers: [
                { daysBefore: 7, refundPercent: 50 },
                { daysBefore: 7, refundPercent: 80 },
              ],
            },
          }),
        ).validate(),
      ).rejects.toThrow(/daysBefore/);
      await expect(
        new airlines(
          airlineDoc({
            cancellationPolicy: {
              tiers: [
                { daysBefore: 7, refundPercent: 50 },
                { daysBefore: 30, refundPercent: 90 },
              ],
            },
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await airlines.collection.indexes();
      expect(
        indexes.map((index) => ({
          key: index.key,
          unique: index.unique ?? false,
        })),
      ).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          { key: { code: 1 }, unique: true },
          { key: { isActive: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(3);
    });
  });

  describe('flights', () => {
    it('uses the flights collection', () => {
      expect(flights.collection.collectionName).toBe('flights');
    });

    it('applies defaults', async () => {
      const flight = await flights.create(flightDoc({ cabins: undefined }));
      expect(flight.status).toBe('scheduled');
      expect(flight.hasBookings).toBe(false);
      expect(flight.cabins).toHaveLength(0);
      expect(flight.cancelledAt).toBeUndefined();
      expect(flight.createdAt).toBeInstanceOf(Date);
    });

    it('trims and uppercases the flight number', async () => {
      const flight = await flights.create(
        flightDoc({ flightNumber: ' ms985 ' }),
      );
      expect(flight.flightNumber).toBe('MS985');
    });

    it('gives each cabin its own _id', async () => {
      const flight = await flights.create(flightDoc());
      expect(flight.cabins[0]).toHaveProperty('_id');
    });

    it('rejects two cabins with the same class', async () => {
      await expect(
        new flights(
          flightDoc({ cabins: [cabinDoc(), cabinDoc({ priceMinor: 20_000 })] }),
        ).validate(),
      ).rejects.toThrow(/cabins/);
      await expect(
        new flights(
          flightDoc({
            cabins: [cabinDoc(), cabinDoc({ cabinClass: 'business' })],
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('allows up to four cabins', async () => {
      const allClasses = ['economy', 'premium_economy', 'business', 'first'];
      await expect(
        new flights(
          flightDoc({
            cabins: allClasses.map((cabinClass) => cabinDoc({ cabinClass })),
          }),
        ).validate(),
      ).resolves.toBeUndefined();
      await expect(
        new flights(
          flightDoc({
            cabins: [...allClasses, 'economy'].map((cabinClass) =>
              cabinDoc({ cabinClass }),
            ),
          }),
        ).validate(),
      ).rejects.toThrow(/cabins/);
    });

    it('rejects seat counters that do not add up to totalSeats', async () => {
      await expect(
        new flights(
          flightDoc({ cabins: [cabinDoc({ availableSeats: 91 })] }),
        ).validate(),
      ).rejects.toThrow(/totalSeats must equal/);
      await expect(
        new flights(
          flightDoc({ cabins: [cabinDoc({ totalSeats: 99 })] }),
        ).validate(),
      ).rejects.toThrow(/totalSeats must equal/);
      await expect(
        new flights(
          flightDoc({
            cabins: [
              cabinDoc({
                totalSeats: 100,
                availableSeats: 100,
                heldSeats: 0,
                bookedSeats: 0,
              }),
            ],
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('validates cabin numbers', async () => {
      const invalid = [
        { totalSeats: 0, availableSeats: 0, heldSeats: 0, bookedSeats: 0 },
        { availableSeats: -1, heldSeats: 95 },
        { priceMinor: 0 },
        { priceMinor: 99.5 },
        { freeBags: -1 },
        { maxBagWeightKg: 0 },
      ];
      for (const overrides of invalid) {
        await expect(
          new flights(flightDoc({ cabins: [cabinDoc(overrides)] })).validate(),
        ).rejects.toThrow(/cabins\.0\./);
      }
      await expect(
        new flights(
          flightDoc({ cabins: [cabinDoc({ maxBagWeightKg: 7.5 })] }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects an arrival that is not after the departure', async () => {
      const departureAt = new Date('2027-01-10T08:00:00.000Z');
      await expect(
        new flights(
          flightDoc({
            departureAt,
            arrivalAt: new Date('2027-01-10T07:00:00.000Z'),
          }),
        ).validate(),
      ).rejects.toThrow(/arrivalAt/);
      await expect(
        new flights(
          flightDoc({ departureAt, arrivalAt: departureAt }),
        ).validate(),
      ).rejects.toThrow(/arrivalAt/);
      await expect(
        new flights(
          flightDoc({
            departureAt,
            arrivalAt: new Date('2027-01-10T08:01:00.000Z'),
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects the same airport for departure and arrival', async () => {
      await expect(
        new flights(
          flightDoc({ departureAirportId: 'CAI', arrivalAirportId: 'CAI' }),
        ).validate(),
      ).rejects.toThrow(/departureAirportId/);
      await expect(
        new flights(
          flightDoc({ departureAirportId: 'CAI', arrivalAirportId: 'HRG' }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('validates the departureLocalDate format', async () => {
      for (const departureLocalDate of [
        '2027-1-10',
        '2027-13-01',
        '10/01/2027',
      ]) {
        await expect(
          new flights(flightDoc({ departureLocalDate })).validate(),
        ).rejects.toThrow(/departureLocalDate/);
      }
    });

    it('rejects a fractional durationMinutes', async () => {
      await expect(
        new flights(flightDoc({ durationMinutes: 720.5 })).validate(),
      ).rejects.toThrow(/durationMinutes/);
    });

    it('rejects a duplicate flight number for the same airline and date', async () => {
      await flights.create(flightDoc());
      await expect(flights.create(flightDoc())).rejects.toMatchObject({
        code: 11000,
      });
      await expect(
        flights.create(
          flightDoc({
            departureAt: new Date('2027-01-11T08:00:00.000Z'),
            arrivalAt: new Date('2027-01-11T20:00:00.000Z'),
            departureLocalDate: '2027-01-11',
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await flights.collection.indexes();
      expect(
        indexes.map((index) => ({
          key: index.key,
          unique: index.unique ?? false,
        })),
      ).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          {
            key: { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
            unique: true,
          },
          {
            key: {
              departureAirportId: 1,
              arrivalAirportId: 1,
              departureLocalDate: 1,
              status: 1,
            },
            unique: false,
          },
          { key: { airlineId: 1, departureAt: 1 }, unique: false },
          { key: { status: 1, departureAt: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(5);
    });
  });
});
