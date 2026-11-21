import { ALL_SCHEMAS } from '../support/all-schemas.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

interface ExpectedIndex {
  /** Keys in order; 1 = ascending, -1 = descending. */
  key: Record<string, 1 | -1>;
  unique?: true;
  partial?: Record<string, unknown>;
  ttl?: number;
}

const REFERENCE_PARTIAL = { reference: { $type: 'string' } };
const THIRTY_DAYS = 30 * 24 * 60 * 60;

/**
 * Written from docs/database/data-model.md (the "Indexes" line of every
 * collection), not from the schema files. The default `_id_` index is not
 * listed. If you change an index, change the data model and this list together.
 */
const EXPECTED: Record<string, ExpectedIndex[]> = {
  // 3.1 reference-data
  countries: [],
  cities: [{ key: { countryCode: 1 } }],
  airports: [{ key: { cityId: 1 } }, { key: { countryCode: 1 } }],
  attractions: [{ key: { cityId: 1 } }],
  currencies: [],
  // 3.2 accounts
  users: [
    { key: { email: 1 }, unique: true },
    { key: { role: 1, status: 1, createdAt: -1 } },
    { key: { 'moderatorOf.providerId': 1 } },
    { key: { name: 1 } },
  ],
  // expiresAt is capped at absoluteExpiresAt, so one TTL index still suffices.
  sessions: [{ key: { userId: 1 } }, { key: { expiresAt: 1 }, ttl: 0 }],
  // 3.3 flights
  airlines: [{ key: { code: 1 }, unique: true }, { key: { isActive: 1 } }],
  flights: [
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
    },
    { key: { airlineId: 1, departureAt: 1 } },
    { key: { status: 1, departureAt: 1 } },
  ],
  // 3.4 flight-bookings
  flight_bookings: [
    { key: { reference: 1 }, unique: true, partial: REFERENCE_PARTIAL },
    { key: { userId: 1, firstDepartureAt: -1 } },
    { key: { 'segments.flightId': 1, status: 1 } },
    { key: { status: 1, holdExpiresAt: 1 } },
    { key: { status: 1, lastDepartureAt: 1 } },
    { key: { status: 1, createdAt: -1 } },
    { key: { createdAt: -1, _id: -1 } },
  ],
  // 3.5 hotels
  hotels: [
    { key: { cityId: 1, isActive: 1 } },
    { key: { countryCode: 1, isActive: 1 } },
    { key: { 'ratingSummary.average': -1 } },
  ],
  rooms: [
    { key: { hotelId: 1, name: 1 }, unique: true },
    { key: { hotelId: 1, isActive: 1 } },
  ],
  room_nights: [
    { key: { roomId: 1, date: 1 }, unique: true },
    { key: { hotelId: 1, date: 1 } },
    { key: { reservationId: 1 } },
    { key: { blockId: 1 } },
  ],
  // 3.6 hotel-bookings
  hotel_reservations: [
    { key: { reference: 1 }, unique: true, partial: REFERENCE_PARTIAL },
    { key: { userId: 1, checkInDate: -1 } },
    { key: { hotelId: 1, checkInDate: 1 } },
    { key: { status: 1, holdExpiresAt: 1 } },
    { key: { status: 1, checkOutDate: 1 } },
    { key: { status: 1, createdAt: -1 } },
    { key: { createdAt: -1, _id: -1 } },
  ],
  reviews: [
    { key: { reservationId: 1 }, unique: true },
    { key: { hotelId: 1, createdAt: -1 } },
    { key: { userId: 1 } },
  ],
  // 3.7 payments
  payments: [
    { key: { stripePaymentIntentId: 1 }, unique: true },
    { key: { bookingType: 1, bookingId: 1 }, unique: true },
    { key: { userId: 1 } },
  ],
  refunds: [
    { key: { bookingType: 1, bookingId: 1 }, unique: true },
    {
      key: { stripeRefundId: 1 },
      unique: true,
      partial: { stripeRefundId: { $type: 'string' } },
    },
    { key: { userId: 1 } },
  ],
  policy_acceptances: [{ key: { bookingType: 1, bookingId: 1 }, unique: true }],
  stripe_webhook_events: [{ key: { receivedAt: 1 }, ttl: THIRTY_DAYS }],
  // 3.8 itineraries
  itineraries: [
    { key: { ownerId: 1, updatedAt: -1 } },
    {
      key: { visibility: 1, isHidden: 1, authorDeactivated: 1, updatedAt: -1 },
    },
    { key: { countryCodes: 1 } },
    { key: { cityIds: 1 } },
    { key: { 'days.activities._id': 1 } },
    { key: { 'days.budgetEntries._id': 1 } },
    { key: { 'transportCosts._id': 1 } },
  ],
  // 3.9 fx
  exchange_rates: [{ key: { rateDate: -1 }, unique: true }],
  // 3.10 blog
  posts: [
    {
      key: { status: 1, isHidden: 1, authorDeactivated: 1, publishedAt: -1 },
    },
    { key: { authorId: 1, updatedAt: -1 } },
    { key: { tags: 1, status: 1 } },
  ],
  comments: [{ key: { postId: 1, createdAt: 1 } }, { key: { authorId: 1 } }],
  likes: [
    { key: { postId: 1, userId: 1 }, unique: true },
    { key: { userId: 1 } },
  ],
  post_image_cleanups: [
    { key: { key: 1 }, unique: true },
    { key: { postId: 1, _id: 1 } },
  ],
  // 3.11 moderation
  reports: [
    { key: { reporterId: 1, targetType: 1, targetId: 1 }, unique: true },
    { key: { status: 1, createdAt: -1 } },
    { key: { targetType: 1, targetId: 1 } },
  ],
  // 3.12 notifications
  notifications: [{ key: { userId: 1, readAt: 1, createdAt: -1 } }],
  // 3.13 audit
  audit_logs: [
    { key: { createdAt: -1 } },
    { key: { actorId: 1, createdAt: -1 } },
    { key: { 'target.type': 1, 'target.id': 1 } },
  ],
};

/** A canonical, comparable string for one index. */
function describe_(index: {
  key: Record<string, number>;
  unique?: boolean;
  partialFilterExpression?: unknown;
  expireAfterSeconds?: number;
  partial?: unknown;
  ttl?: number;
}): string {
  return JSON.stringify({
    key: Object.entries(index.key),
    unique: index.unique === true,
    partial: index.partialFilterExpression ?? index.partial ?? null,
    ttl: index.expireAfterSeconds ?? index.ttl ?? null,
  });
}

describe('indexes match docs/database/data-model.md', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase('indexes');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  it('covers exactly the 28 collections of the data model', () => {
    expect(Object.keys(ALL_SCHEMAS).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
    expect(Object.keys(EXPECTED)).toHaveLength(28);
  });

  it.each(Object.keys(EXPECTED))(
    '%s has exactly the expected indexes',
    async (name) => {
      const schema = ALL_SCHEMAS[name];
      // The schema must name its collection explicitly, never rely on pluralising.
      expect(schema.get('collection')).toBe(name);

      const model = db.connection.model(name, schema);
      await model.createCollection();
      await model.syncIndexes();

      const actual = (await model.collection.listIndexes().toArray())
        .filter((index) => index.name !== '_id_')
        .map((index) => describe_(index as never))
        .sort();
      const expected = EXPECTED[name].map((index) => describe_(index)).sort();

      expect(actual).toEqual(expected);
    },
  );
});
