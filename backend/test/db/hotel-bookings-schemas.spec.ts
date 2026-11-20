import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../src/common/dates/date-only.js';
import { getPlatformCurrency } from '../../src/common/money/platform-currency.js';
import {
  HotelReservation,
  HotelReservationSchema,
} from '../../src/modules/hotel-bookings/schemas/hotel-reservation.schema.js';
import {
  Review,
  ReviewSchema,
} from '../../src/modules/hotel-bookings/schemas/review.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

function roomDoc(overrides: Record<string, unknown> = {}) {
  return {
    roomId: new Types.ObjectId(),
    roomName: '101',
    roomType: 'Deluxe King',
    pricePerNightMinor: 12_000,
    adults: 2,
    childAges: [],
    subtotalMinor: 36_000,
    ...overrides,
  };
}

function reservationDoc(overrides: Record<string, unknown> = {}) {
  return {
    userId: new Types.ObjectId(),
    hotelId: new Types.ObjectId(),
    status: 'pending_payment' as const,
    checkInDate: toDateOnly('2027-03-01'),
    checkOutDate: toDateOnly('2027-03-04'),
    nights: 3,
    rooms: [roomDoc()],
    totalMinor: 36_000,
    policySnapshot: {
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 30, refundPercent: 100 },
      ],
      checkInTime: '14:00',
      checkOutTime: '12:00',
    },
    holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    ...overrides,
  };
}

function reviewDoc(overrides: Record<string, unknown> = {}) {
  return {
    reservationId: new Types.ObjectId(),
    hotelId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    rating: 4,
    ...overrides,
  };
}

function indexSummary(
  indexes: {
    key: unknown;
    unique?: boolean;
    partialFilterExpression?: unknown;
  }[],
) {
  return indexes.map((index) => ({
    key: index.key,
    unique: index.unique ?? false,
    partialFilterExpression: index.partialFilterExpression,
  }));
}

describe('hotel-bookings schemas', () => {
  let db: TestDatabase;
  let reservations: Model<HotelReservation>;
  let reviews: Model<Review>;

  beforeAll(async () => {
    db = await startTestDatabase('hotel-bookings');
    reservations = db.connection.model<HotelReservation>(
      HotelReservation.name,
      HotelReservationSchema,
    );
    reviews = db.connection.model<Review>(Review.name, ReviewSchema);
    await Promise.all([reservations.init(), reviews.init()]);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await Promise.all([reservations.deleteMany({}), reviews.deleteMany({})]);
  });

  it('uses the hotel_reservations and reviews collections', () => {
    expect(reservations.collection.collectionName).toBe('hotel_reservations');
    expect(reviews.collection.collectionName).toBe('reviews');
  });

  describe('hotel_reservations', () => {
    it('saves a valid reservation with its defaults and no reference', async () => {
      const reservation = await reservations.create(
        reservationDoc({ rooms: [roomDoc({ childAges: undefined })] }),
      );
      expect(reservation.currency).toBe(getPlatformCurrency());
      expect(reservation.reference).toBeUndefined();
      expect(reservation.confirmedAt).toBeUndefined();
      expect(reservation.expiredAt).toBeUndefined();
      expect(reservation.completedAt).toBeUndefined();
      expect(reservation.cancellation).toBeUndefined();
      expect(reservation.rooms[0]).toHaveProperty('_id');
      expect(reservation.rooms[0].childAges).toEqual([]);
      expect(reservation.policySnapshot).not.toHaveProperty('_id');
      expect(reservation.get('createdAt')).toBeInstanceOf(Date);
    });

    it('requires the status, with no default', async () => {
      for (const status of [undefined, 'held']) {
        await expect(
          new reservations(reservationDoc({ status })).validate(),
        ).rejects.toThrow(/status/);
      }
      await expect(
        new reservations(reservationDoc({ status: 'confirmed' })).validate(),
      ).resolves.toBeUndefined();
    });

    it('validates the reference format', async () => {
      for (const reference of [
        'HR12345',
        'hr123456',
        'FB123456',
        'HR1234567',
      ]) {
        await expect(
          new reservations(reservationDoc({ reference })).validate(),
        ).rejects.toThrow(/reference/);
      }
      await expect(
        new reservations(reservationDoc({ reference: 'HRA1B2C3' })).validate(),
      ).resolves.toBeUndefined();
    });

    it('allows many reservations without a reference but no duplicate reference', async () => {
      await reservations.create(reservationDoc());
      await expect(
        reservations.create(reservationDoc()),
      ).resolves.toBeDefined();

      await reservations.create(reservationDoc({ reference: 'HRA1B2C3' }));
      await expect(
        reservations.create(reservationDoc({ reference: 'HRA1B2C3' })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        reservations.create(reservationDoc({ reference: 'HRZZZ999' })),
      ).resolves.toBeDefined();
    });

    it('requires checkOutDate after checkInDate', async () => {
      for (const checkOutDate of ['2027-03-01', '2027-02-28']) {
        await expect(
          new reservations(
            reservationDoc({ checkOutDate: toDateOnly(checkOutDate) }),
          ).validate(),
        ).rejects.toThrow(/checkOutDate must be after checkInDate/);
      }
      await expect(
        new reservations(
          reservationDoc({
            checkOutDate: toDateOnly('2027-03-02'),
            nights: 1,
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects check-in and check-out dates with a time part', async () => {
      await expect(
        new reservations(
          reservationDoc({ checkInDate: new Date('2027-03-01T14:00:00.000Z') }),
        ).validate(),
      ).rejects.toThrow(/checkInDate/);
      await expect(
        new reservations(
          reservationDoc({
            checkOutDate: new Date('2027-03-04T12:00:00.000Z'),
          }),
        ).validate(),
      ).rejects.toThrow(/checkOutDate/);
    });

    it('requires nights to be an integer of at least 1', async () => {
      for (const nights of [0, 1.5, undefined]) {
        await expect(
          new reservations(reservationDoc({ nights })).validate(),
        ).rejects.toThrow(/nights/);
      }
      await expect(
        new reservations(
          reservationDoc({ checkOutDate: toDateOnly('2027-03-02'), nights: 1 }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('requires at least one room', async () => {
      await expect(
        new reservations(reservationDoc({ rooms: [] })).validate(),
      ).rejects.toThrow(/rooms must have at least 1 item/);
      await expect(
        new reservations(reservationDoc({ rooms: [roomDoc()] })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects the same room twice', async () => {
      const roomId = new Types.ObjectId();
      await expect(
        new reservations(
          reservationDoc({ rooms: [roomDoc({ roomId }), roomDoc({ roomId })] }),
        ).validate(),
      ).rejects.toThrow(/duplicate roomId/);
      await expect(
        new reservations(
          reservationDoc({ rooms: [roomDoc({ roomId }), roomDoc()] }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a reservation without an adult', async () => {
      await expect(
        new reservations(
          reservationDoc({
            rooms: [
              roomDoc({ adults: 0, childAges: [10] }),
              roomDoc({ adults: 0, childAges: [12] }),
            ],
          }),
        ).validate(),
      ).rejects.toThrow(/at least one adult/);
      await expect(
        new reservations(
          reservationDoc({
            rooms: [
              roomDoc({ adults: 1, childAges: [] }),
              roomDoc({ adults: 0, childAges: [12] }),
            ],
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a room without a guest', async () => {
      await expect(
        new reservations(
          reservationDoc({
            rooms: [roomDoc({ adults: 2 }), roomDoc({ adults: 0 })],
          }),
        ).validate(),
      ).rejects.toThrow(/every room must have at least one guest/);
      await expect(
        new reservations(
          reservationDoc({
            rooms: [roomDoc({ adults: 2 }), roomDoc({ adults: 1 })],
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('accepts child ages 0-17 only', async () => {
      for (const age of [18, -1, 5.5]) {
        await expect(
          new reservations(
            reservationDoc({ rooms: [roomDoc({ childAges: [age] })] }),
          ).validate(),
        ).rejects.toThrow(/childAges/);
      }
      await expect(
        new reservations(
          reservationDoc({ rooms: [roomDoc({ childAges: [0, 17] })] }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('validates the reserved room numbers', async () => {
      const invalid = [
        { pricePerNightMinor: -1 },
        { adults: -1 },
        { adults: 1.5 },
        { subtotalMinor: 10.5 },
        { roomName: undefined },
        { roomType: undefined },
      ];
      for (const overrides of invalid) {
        await expect(
          new reservations(
            reservationDoc({ rooms: [roomDoc(overrides)] }),
          ).validate(),
        ).rejects.toThrow(
          new RegExp(`rooms\\.0\\.${Object.keys(overrides)[0]}`),
        );
      }
      await expect(
        new reservations(
          reservationDoc({
            rooms: [roomDoc({ pricePerNightMinor: 0, subtotalMinor: 0 })],
            totalMinor: 0,
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('validates the total and requires the hold expiry', async () => {
      for (const overrides of [
        { totalMinor: -1 },
        { totalMinor: 1.5 },
        { holdExpiresAt: undefined },
      ]) {
        await expect(
          new reservations(reservationDoc(overrides)).validate(),
        ).rejects.toThrow(new RegExp(Object.keys(overrides)[0]));
      }
      await expect(
        new reservations(reservationDoc({ totalMinor: 0 })).validate(),
      ).resolves.toBeUndefined();
    });

    it('validates the policy snapshot', async () => {
      const snapshot = reservationDoc().policySnapshot;
      const invalid = [
        { ...snapshot, checkInTime: '24:00' },
        { ...snapshot, checkOutTime: '9:5' },
        { ...snapshot, checkInTime: undefined },
        {
          ...snapshot,
          cancellationTiers: [
            { daysBefore: 7, refundPercent: 50 },
            { daysBefore: 7, refundPercent: 100 },
          ],
        },
      ];
      for (const policySnapshot of invalid) {
        await expect(
          new reservations(reservationDoc({ policySnapshot })).validate(),
        ).rejects.toThrow(/policySnapshot\./);
      }
      await expect(
        new reservations(
          reservationDoc({ policySnapshot: undefined }),
        ).validate(),
      ).rejects.toThrow(/policySnapshot/);
      await expect(
        new reservations(
          reservationDoc({
            policySnapshot: {
              cancellationTiers: [],
              checkInTime: '15:30',
              checkOutTime: '11:00',
            },
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('accepts a cancellation', async () => {
      await expect(
        new reservations(
          reservationDoc({
            status: 'cancelled',
            cancellation: {
              cancelledAt: new Date(),
              cancelledBy: 'user',
              refundPercent: 50,
              refundAmountMinor: 18_000,
            },
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await reservations.collection.indexes();
      const plain = (key: Record<string, number>) => ({
        key,
        unique: false,
        partialFilterExpression: undefined,
      });
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          plain({ _id: 1 }),
          {
            key: { reference: 1 },
            unique: true,
            partialFilterExpression: { reference: { $type: 'string' } },
          },
          plain({ userId: 1, checkInDate: -1 }),
          plain({ hotelId: 1, checkInDate: 1 }),
          plain({ status: 1, holdExpiresAt: 1 }),
          plain({ status: 1, checkOutDate: 1 }),
          plain({ status: 1, createdAt: -1 }),
        ]),
      );
      expect(indexes).toHaveLength(7);
    });
  });

  describe('reviews', () => {
    it('saves a review with isHidden false by default', async () => {
      const review = await reviews.create(reviewDoc());
      expect(review.isHidden).toBe(false);
      expect(review.text).toBeUndefined();
      expect(review.get('createdAt')).toBeInstanceOf(Date);
    });

    it('validates rating and text', async () => {
      const invalid = [
        { rating: 0 },
        { rating: 6 },
        { rating: 4.5 },
        { rating: undefined },
        { text: 'x'.repeat(1001) },
      ];
      for (const overrides of invalid) {
        await expect(
          new reviews(reviewDoc(overrides)).validate(),
        ).rejects.toThrow(new RegExp(Object.keys(overrides)[0]));
      }
      for (const rating of [1, 5]) {
        await expect(
          new reviews(reviewDoc({ rating, text: 'x'.repeat(1000) })).validate(),
        ).resolves.toBeUndefined();
      }
    });

    it('rejects a second review for the same reservation', async () => {
      const reservationId = new Types.ObjectId();
      await reviews.create(reviewDoc({ reservationId }));
      await expect(
        reviews.create(reviewDoc({ reservationId })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(reviews.create(reviewDoc())).resolves.toBeDefined();
    });

    it('round-trips an optional moderator reply and replaces it without changing the review', async () => {
      const review = await reviews.create(reviewDoc({ text: 'A good stay' }));
      const original = await reviews.findById(review._id).lean().orFail();
      expect(original.reply).toBeUndefined();

      for (const reply of ['Thank you for staying with us', 'x'.repeat(1000)]) {
        await reviews.updateOne(
          { _id: review._id },
          { $set: { reply } },
          { runValidators: true },
        );
        const saved = await reviews.findById(review._id).lean().orFail();
        expect(saved.reply).toBe(reply);
        expect(saved).toMatchObject({
          reservationId: original.reservationId,
          hotelId: original.hotelId,
          userId: original.userId,
          rating: original.rating,
          text: original.text,
          isHidden: original.isHidden,
        });
      }
    });

    it('rejects replies longer than 1000 characters on create and update', async () => {
      const reply = 'x'.repeat(1001);
      await expect(reviews.create(reviewDoc({ reply }))).rejects.toThrow(
        /reply/,
      );

      const review = await reviews.create(
        reviewDoc({ reply: 'Thank you for your feedback' }),
      );
      await expect(
        reviews.updateOne(
          { _id: review._id },
          { $set: { reply } },
          { runValidators: true },
        ),
      ).rejects.toThrow(/reply/);
      const saved = await reviews.findById(review._id).lean().orFail();
      expect(saved.reply).toBe('Thank you for your feedback');
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await reviews.collection.indexes();
      expect(
        indexes.map((index) => ({
          key: index.key,
          unique: index.unique ?? false,
        })),
      ).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          { key: { reservationId: 1 }, unique: true },
          { key: { hotelId: 1, createdAt: -1 }, unique: false },
          { key: { userId: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(4);
    });
  });
});
