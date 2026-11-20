import type { Model } from 'mongoose';
import { FakeFlightsData } from '../fakes/flights-data.fake.js';
import type { FakeSeatInventory } from '../fakes/seat-inventory.fake.js';
import type {
  FlightBooking,
  FlightBookingStatus,
} from '../../src/modules/flight-bookings/schemas/flight-booking.schema.js';

/** Three flights, each with one economy cabin of 50 seats. */
export const AIRLINE = '6553a1f0c2b4e8a9d0f1f001';
export const OUT = '6553a1f0c2b4e8a9d0f1f002';
export const OUT_ECO = '6553a1f0c2b4e8a9d0f1f003';
export const BACK = '6553a1f0c2b4e8a9d0f1f004';
export const BACK_ECO = '6553a1f0c2b4e8a9d0f1f005';
export const OTHER = '6553a1f0c2b4e8a9d0f1f006';
export const OTHER_ECO = '6553a1f0c2b4e8a9d0f1f007';
export const USER = '6553a1f0c2b4e8a9d0f1f099';

export const OUT_AT = new Date('2027-03-10T08:00:00.000Z');
export const BACK_AT = new Date('2027-03-17T08:00:00.000Z');
export const OTHER_AT = new Date('2027-03-20T08:00:00.000Z');
export const HOUR = 3_600_000;

const CABIN_OF: Record<string, string> = {
  [OUT]: OUT_ECO,
  [BACK]: BACK_ECO,
  [OTHER]: OTHER_ECO,
};
const DEPARTURE_OF: Record<string, Date> = {
  [OUT]: OUT_AT,
  [BACK]: BACK_AT,
  [OTHER]: OTHER_AT,
};

/** The fake flights data: OUT, BACK and OTHER, 50 economy seats each. */
export function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS' });
  for (const id of [OUT, BACK, OTHER]) {
    const departureAt = DEPARTURE_OF[id];
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
          id: CABIN_OF[id],
          cabinClass: 'economy',
          totalSeats: 50,
          priceMinor: 20_000,
        },
      ],
    });
  }
  return data;
}

function segment(
  direction: 'outbound' | 'return',
  flightId: string,
  departureAt: Date,
) {
  return {
    direction,
    flightId,
    cabinId: CABIN_OF[flightId],
    cabinClass: 'economy' as const,
    airlineId: AIRLINE,
    flightNumber: 'MS100',
    departureAirportId: direction === 'outbound' ? 'CAI' : 'DXB',
    arrivalAirportId: direction === 'outbound' ? 'DXB' : 'CAI',
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 4 * HOUR),
    fareMinor: 20_000,
    policy: {
      cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
      freeBags: 1,
      maxBagWeightKg: 23,
      extraBagPriceMinor: 0,
      maxExtraBagsPerPassenger: 0,
    },
  };
}

let references = 0;

export interface SeedBookingOptions {
  status?: FlightBookingStatus;
  /** The outbound flight (default OUT). */
  outbound?: string;
  /** Adds a return flight and makes it a round trip. */
  back?: string;
  userId?: string;
  totalMinor?: number;
}

/**
 * Saves a booking of 2 passengers (2 seats). Its seats are booked when it is
 * `confirmed` and held when it is `pending_payment`, as in real life.
 */
export async function seedBooking(
  bookings: Model<FlightBooking>,
  seats: FakeSeatInventory,
  options: SeedBookingOptions = {},
) {
  const {
    status = 'confirmed',
    outbound = OUT,
    back,
    userId = USER,
    totalMinor = 40_000,
  } = options;
  references += 1;
  const segments = [segment('outbound', outbound, DEPARTURE_OF[outbound])];
  if (back) segments.push(segment('return', back, DEPARTURE_OF[back]));
  const booking = await bookings.create({
    userId,
    // FB + 6 characters, unique per booking.
    ...(status === 'confirmed' ||
    status === 'completed' ||
    status === 'cancelled'
      ? { reference: `FBT${String(references).padStart(5, '0')}` }
      : {}),
    status,
    tripType: back ? ('round_trip' as const) : ('one_way' as const),
    segments,
    passengers: [
      {
        type: 'adult' as const,
        fullName: 'Aya Amr',
        dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
        documentNumber: 'A1234567',
        extraBagCount: 0,
      },
      {
        type: 'adult' as const,
        fullName: 'Jana Test',
        dateOfBirth: new Date('1991-02-02T00:00:00.000Z'),
        documentNumber: 'B7654321',
        extraBagCount: 0,
      },
    ],
    seatCount: 2,
    pricing: {
      fareTotalMinor: totalMinor,
      baggageTotalMinor: 0,
      totalMinor,
      currency: 'USD',
    },
    holdExpiresAt: new Date('2027-03-01T00:10:00.000Z'),
    firstDepartureAt: DEPARTURE_OF[outbound],
    lastDepartureAt: back ? DEPARTURE_OF[back] : DEPARTURE_OF[outbound],
  });
  if (status === 'confirmed' || status === 'pending_payment') {
    const items = segments.map((s) => ({
      flightId: s.flightId,
      cabinId: s.cabinId,
      seats: 2,
    }));
    await seats.hold(items);
    if (status === 'confirmed') await seats.confirm(items);
  }
  return booking;
}
