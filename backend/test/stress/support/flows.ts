import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import type { Actor, Stress } from './stress-app.js';
import { dateIn, eventually } from './stress-app.js';

/** Flows the attacks reuse, all through the public API (no model writes). */

let flightSequence = 0;
let roomSequence = 0;

export interface TestFlight {
  flightId: string;
  cabinId: string;
  departureAt: Date;
}

async function zoneOf(s: Stress, airport: string): Promise<string> {
  const doc = await s.col('airports').findOne({ _id: airport as never });
  if (!doc) throw new Error(`airport ${airport} is not in the reference data`);
  return doc.timeZone as string;
}

/** `YYYY-MM-DDTHH:mm` of `at` in the airport's zone (FLT-03 input). */
export async function localOf(
  s: Stress,
  airport: string,
  at: Date,
): Promise<string> {
  return DateTime.fromJSDate(at, { zone: await zoneOf(s, airport) }).toFormat(
    "yyyy-MM-dd'T'HH:mm",
  );
}

/** A new scheduled flight with one cabin, created by the airline's moderator. */
export async function createFlight(
  s: Stress,
  moderator: Actor,
  options: {
    from?: string;
    to?: string;
    departureAt?: Date;
    durationMinutes?: number;
    seats?: number;
    priceMinor?: number;
    cabinClass?: string;
  } = {},
): Promise<TestFlight> {
  const from = options.from ?? 'CAI';
  const to = options.to ?? 'DXB';
  // Whole minutes: the API takes local times to the minute.
  const departureAt = new Date(
    Math.floor(
      (options.departureAt ?? new Date(Date.now() + 3 * 86_400_000)).getTime() /
        60_000,
    ) * 60_000,
  );
  const arrivalAt = new Date(
    departureAt.getTime() + (options.durationMinutes ?? 180) * 60_000,
  );
  flightSequence += 1;
  const created = await moderator.post('/flights', {
    flightNumber: `ST ${flightSequence}`,
    departureAirportId: from,
    arrivalAirportId: to,
    departureLocal: await localOf(s, from, departureAt),
    arrivalLocal: await localOf(s, to, arrivalAt),
  });
  if (created.status !== 201) {
    throw new Error(
      `create flight failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  const flightId = created.body._id as string;
  const cabinClass = options.cabinClass ?? 'economy';
  const cabin = await moderator.post(`/flights/${flightId}/cabins`, {
    cabinClass,
    totalSeats: options.seats ?? 3,
    priceMinor: options.priceMinor ?? 10_000,
    freeBags: 1,
    maxBagWeightKg: 23,
  });
  if (cabin.status !== 201 && cabin.status !== 200) {
    throw new Error(
      `add cabin failed: ${cabin.status} ${JSON.stringify(cabin.body)}`,
    );
  }
  const doc = await s
    .col('flights')
    .findOne({ _id: new Types.ObjectId(flightId) });
  const found = (
    (doc?.cabins ?? []) as { _id: Types.ObjectId; cabinClass: string }[]
  ).find((c) => c.cabinClass === cabinClass);
  return { flightId, cabinId: found!._id.toHexString(), departureAt };
}

export function adult(index = 0) {
  return {
    type: 'adult',
    fullName: `Passenger ${index}`,
    dateOfBirth: '1990-01-01',
    documentNumber: `P${100000 + index}`,
    extraBagCount: 0,
  };
}

export function flightBody(
  segments: { flightId: string; cabinId: string }[],
  passengers = 1,
) {
  return {
    tripType: segments.length === 2 ? 'round_trip' : 'one_way',
    segments: segments.map((s) => ({
      flightId: s.flightId,
      cabinId: s.cabinId,
    })),
    passengers: Array.from({ length: passengers }, (_, i) => adult(i)),
  };
}

export function holdFlight(
  user: Actor,
  flight: { flightId: string; cabinId: string },
  passengers = 1,
) {
  return user.post('/flight-bookings/hold', flightBody([flight], passengers));
}

export interface StartedPayment {
  bookingId: string;
  paymentId: string;
  paymentIntentId: string;
}

/** Accepts the policies and starts the payment of a pending booking. */
export async function startPayment(
  s: Stress,
  user: Actor,
  type: 'flight' | 'hotel',
  bookingId: string,
): Promise<StartedPayment> {
  const accepted = await user.post(
    `/bookings/${type}/${bookingId}/accept-policies`,
    { accepted: true },
  );
  if (accepted.status >= 300) {
    throw new Error(
      `accept policies failed: ${accepted.status} ${JSON.stringify(accepted.body)}`,
    );
  }
  const started = await user.post('/payments', {
    bookingType: type,
    bookingId,
  });
  if (started.status >= 300) {
    throw new Error(
      `start payment failed: ${started.status} ${JSON.stringify(started.body)}`,
    );
  }
  const payment = await s
    .col('payments')
    .findOne({ _id: new Types.ObjectId(started.body.paymentId as string) });
  return {
    bookingId,
    paymentId: started.body.paymentId,
    paymentIntentId: payment!.stripePaymentIntentId as string,
  };
}

export function bookingCollection(type: 'flight' | 'hotel'): string {
  return type === 'flight' ? 'flight_bookings' : 'hotel_reservations';
}

export async function statusOf(
  s: Stress,
  type: 'flight' | 'hotel',
  bookingId: string,
): Promise<string | undefined> {
  const doc = await s
    .col(bookingCollection(type))
    .findOne({ _id: new Types.ObjectId(bookingId) });
  return doc?.status as string | undefined;
}

/** Pays through the signed webhook and waits for the booking to confirm. */
export async function payAndConfirm(
  s: Stress,
  user: Actor,
  type: 'flight' | 'hotel',
  bookingId: string,
): Promise<StartedPayment> {
  const started = await startPayment(s, user, type, bookingId);
  const response = await s.payWebhook(started.paymentIntentId);
  if (response.status >= 300) {
    throw new Error(`webhook failed: ${response.status}`);
  }
  const status = await eventually(async () =>
    (await statusOf(s, type, bookingId)) === 'confirmed' ? 'confirmed' : '',
  );
  if (status !== 'confirmed') {
    throw new Error(`booking ${bookingId} was not confirmed after payment`);
  }
  return started;
}

/** A held and confirmed flight booking for `user`, on a new flight unless given. */
export async function confirmedFlightBooking(
  s: Stress,
  user: Actor,
  flight: TestFlight,
  passengers = 1,
): Promise<StartedPayment> {
  const held = await holdFlight(user, flight, passengers);
  if (held.status !== 201) {
    throw new Error(`hold failed: ${held.status} ${JSON.stringify(held.body)}`);
  }
  return payAndConfirm(s, user, 'flight', held.body.bookingId);
}

/** A new room in the hotel, bookable from today for `days` days. */
export async function createRoom(
  moderator: Actor,
  hotelId: string,
  options: { days?: number; maxOccupancy?: number; priceMinor?: number } = {},
): Promise<string> {
  roomSequence += 1;
  const created = await moderator.post(`/hotels/${hotelId}/rooms`, {
    name: `Stress Room ${roomSequence} ${Date.now()}`,
    type: 'Standard',
    beds: 1,
    maxOccupancy: options.maxOccupancy ?? 2,
    pricePerNightMinor: options.priceMinor ?? 10_000,
  });
  if (created.status !== 201) {
    throw new Error(
      `create room failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  const roomId = created.body._id as string;
  const ranged = await moderator.patch(
    `/hotels/${hotelId}/rooms/${roomId}/availability`,
    {
      op: 'SET_RANGES',
      ranges: [{ fromDate: dateIn(0), toDate: dateIn(options.days ?? 120) }],
    },
  );
  if (ranged.status !== 200) {
    throw new Error(
      `set availability failed: ${ranged.status} ${JSON.stringify(ranged.body)}`,
    );
  }
  return roomId;
}

export function holdRoom(
  user: Actor,
  hotelId: string,
  roomIds: string[],
  checkInDate: string,
  checkOutDate: string,
) {
  return user.post('/hotel-bookings', {
    hotelId,
    checkInDate,
    checkOutDate,
    rooms: roomIds.map((roomId) => ({ roomId, adults: 1, childAges: [] })),
  });
}

export async function confirmedHotelBooking(
  s: Stress,
  user: Actor,
  hotelId: string,
  roomId: string,
  checkInDate: string,
  checkOutDate: string,
): Promise<StartedPayment> {
  const held = await holdRoom(
    user,
    hotelId,
    [roomId],
    checkInDate,
    checkOutDate,
  );
  if (held.status !== 201) {
    throw new Error(
      `hotel hold failed: ${held.status} ${JSON.stringify(held.body)}`,
    );
  }
  return payAndConfirm(s, user, 'hotel', held.body.reservationId);
}

/** The JSON error shape of api-contract §3: `{ code, message }`, code a string. */
export function isErrorShape(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { code?: unknown }).code === 'string' &&
    typeof (body as { message?: unknown }).message === 'string'
  );
}
