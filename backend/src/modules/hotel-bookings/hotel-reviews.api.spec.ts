import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { ReportTargetType } from '../moderation/ports/reportable-content.port.js';
import { ReportableContentRegistry } from '../moderation/ports/reportable-content.registry.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';
import { Review } from './schemas/review.schema.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1b201';
const ROOM = '6553a1f0c2b4e8a9d0f1b202';
const URL = `/api/hotels/${HOTEL}/reviews`;

function hotel() {
  return {
    id: HOTEL,
    name: 'Nile View',
    address: 'Corniche',
    cityId: 'cairo',
    countryCode: 'EG',
    photos: [],
    amenities: [],
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationPolicy: { tiers: [] },
    isActive: true,
    ratingSummary: { average: null, count: 0 },
  };
}

describe('Hotel reviews API (HTL-23, HTL-24)', () => {
  let t: TestApp;
  let reservations: Model<HotelReservation>;
  let storedReviews: Model<Review>;
  let registry: ReportableContentRegistry;
  const hotels = new FakeHotelsService({ hotels: [hotel()] });

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(HotelsService)
          .useValue(hotels)
          .overrideProvider(RoomNightInventory)
          .useValue(new FakeRoomNightInventory(hotels)),
    });
    reservations = t.moduleRef.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
    storedReviews = t.moduleRef.get<Model<Review>>(getModelToken(Review.name));
    registry = t.moduleRef.get(ReportableContentRegistry);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    hotels.data.hotels = [hotel()];
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function seedReservation(
    userId: string,
    status: HotelReservationStatus = HotelReservationStatus.COMPLETED,
  ) {
    return reservations.create({
      userId: new Types.ObjectId(userId),
      hotelId: new Types.ObjectId(HOTEL),
      status,
      checkInDate: toDateOnly('2026-03-10'),
      checkOutDate: toDateOnly('2026-03-11'),
      nights: 1,
      rooms: [
        {
          roomId: new Types.ObjectId(ROOM),
          roomName: '101',
          roomType: 'Double',
          pricePerNightMinor: 10_000,
          adults: 1,
          childAges: [],
          subtotalMinor: 10_000,
        },
      ],
      totalMinor: 10_000,
      currency: 'USD',
      policySnapshot: {
        cancellationTiers: [],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      holdExpiresAt: new Date('2026-03-10T00:10:00.000Z'),
      ...(status === HotelReservationStatus.COMPLETED
        ? { completedAt: new Date('2026-03-12T00:00:00.000Z') }
        : {}),
    });
  }

  async function submitReview(
    cookie: string,
    reservationId: string,
    body: { rating: number; text?: string },
  ) {
    return t
      .http()
      .post(`/api/hotel-bookings/${reservationId}/review`)
      .set('Cookie', cookie)
      .send(body);
  }

  it('creates one review per completed reservation and returns its rating', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const reservation = await seedReservation(owner.id);
    const response = await submitReview(
      owner.cookie,
      reservation._id.toString(),
      {
        rating: 5,
        text: 'Wonderful stay',
      },
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      _id: expect.stringMatching(/^[0-9a-f]{24}$/),
      rating: 5,
      text: 'Wonderful stay',
      isHidden: false,
    });
    expect(hotels.data.hotels[0]?.ratingSummary).toEqual({
      average: 5,
      count: 1,
    });
    const hotelDetails = await t.http().get(`/api/hotels/${HOTEL}`);
    expect(hotelDetails.status).toBe(200);
    expect(hotelDetails.body.ratingSummary).toEqual({
      average: 5,
      count: 1,
    });

    const duplicate = await submitReview(
      owner.cookie,
      reservation._id.toString(),
      { rating: 4 },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe(ErrorCode.AlreadyReviewed);
    expect(await storedReviews.countDocuments()).toBe(1);
  });

  it('validates rating and review length and permits 1000 characters', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const reservation = await seedReservation(owner.id);

    const invalidRating = await submitReview(
      owner.cookie,
      reservation._id.toString(),
      { rating: 0 },
    );
    expect(invalidRating.status).toBe(400);
    expect(invalidRating.body.code).toBe(ErrorCode.ValidationFailed);

    const invalidText = await submitReview(
      owner.cookie,
      reservation._id.toString(),
      { rating: 5, text: 'x'.repeat(1001) },
    );
    expect(invalidText.status).toBe(400);
    expect(invalidText.body.code).toBe(ErrorCode.ValidationFailed);

    const acceptedText = 'x'.repeat(1000);
    const valid = await submitReview(owner.cookie, reservation._id.toString(), {
      rating: 5,
      text: acceptedText,
    });
    expect(valid.status).toBe(201);
    expect(valid.body.text).toBe(acceptedText);
  });

  it('requires a user role and a completed reservation owned by the caller', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const other = await loginAs(t.connection, UserRole.USER);
    const moderator = await loginAs(t.connection, UserRole.HOTEL_MODERATOR, {
      providerId: HOTEL,
    });
    const completed = await seedReservation(owner.id);
    const pending = await seedReservation(
      owner.id,
      HotelReservationStatus.PENDING_PAYMENT,
    );

    const unauthenticated = await t
      .http()
      .post(`/api/hotel-bookings/${completed._id.toString()}/review`)
      .send({ rating: 5 });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe(ErrorCode.NotAuthenticated);

    const wrongRole = await submitReview(
      moderator.cookie,
      completed._id.toString(),
      { rating: 5 },
    );
    expect(wrongRole.status).toBe(403);
    expect(wrongRole.body.code).toBe(ErrorCode.ForbiddenRole);

    const wrongOwner = await submitReview(
      other.cookie,
      completed._id.toString(),
      { rating: 5 },
    );
    expect(wrongOwner.status).toBe(404);
    expect(wrongOwner.body.code).toBe(ErrorCode.NotFound);

    const notCompleted = await submitReview(
      owner.cookie,
      pending._id.toString(),
      { rating: 5 },
    );
    expect(notCompleted.status).toBe(409);
    expect(notCompleted.body.code).toBe(ErrorCode.InvalidStatusTransition);

    const unknown = await submitReview(
      owner.cookie,
      new Types.ObjectId().toString(),
      { rating: 5 },
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe(ErrorCode.NotFound);
  });

  it('lets the owner edit and delete a review, and recomputes the summary', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const other = await loginAs(t.connection, UserRole.USER);
    const reservation = await seedReservation(owner.id);
    const created = await submitReview(
      owner.cookie,
      reservation._id.toString(),
      {
        rating: 5,
        text: 'Good',
      },
    );
    const reviewId = created.body._id as string;

    const denied = await t
      .http()
      .patch(`/api/reviews/${reviewId}`)
      .set('Cookie', other.cookie)
      .send({ rating: 1 });
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe(ErrorCode.NotFound);

    const updated = await t
      .http()
      .patch(`/api/reviews/${reviewId}`)
      .set('Cookie', owner.cookie)
      .send({ rating: 4, text: null });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ _id: reviewId, rating: 4 });
    expect(updated.body.text).toBeUndefined();
    expect(hotels.data.hotels[0]?.ratingSummary).toEqual({
      average: 4,
      count: 1,
    });

    const removed = await t
      .http()
      .delete(`/api/reviews/${reviewId}`)
      .set('Cookie', owner.cookie);
    expect(removed.status).toBe(204);
    expect(hotels.data.hotels[0]?.ratingSummary).toEqual({
      average: null,
      count: 0,
    });
  });

  it('lists public reviews newest-first, paginated, and excludes hidden reviews', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const firstReservation = await seedReservation(owner.id);
    const secondReservation = await seedReservation(owner.id);
    const first = await submitReview(
      owner.cookie,
      firstReservation._id.toString(),
      { rating: 3 },
    );
    const second = await submitReview(
      owner.cookie,
      secondReservation._id.toString(),
      { rating: 5, text: 'Newest' },
    );

    const newest = await t.http().get(`${URL}?page=1&limit=1`);
    expect(newest.status).toBe(200);
    expect(newest.body).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(newest.body.items[0]._id).toBe(second.body._id);

    await registry.get(ReportTargetType.REVIEW).hide(second.body._id);
    const visible = await t.http().get(URL);
    expect(visible.status).toBe(200);
    expect(
      visible.body.items.map((review: { _id: string }) => review._id),
    ).toEqual([first.body._id]);
    expect(visible.body.total).toBe(1);
  });

  it('names the review author, and "Deleted user" once the author is deactivated (ACC-12)', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const reservation = await seedReservation(owner.id);
    await submitReview(owner.cookie, reservation._id.toString(), {
      rating: 4,
      text: 'Lovely',
    });

    const active = await t.http().get(URL).expect(200);
    expect(active.body.items[0].authorName).toBe('Test user');

    await t.connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(owner.id) },
        { $set: { status: 'deactivated' } },
      );
    const deactivated = await t.http().get(URL).expect(200);
    expect(deactivated.body.items[0].authorName).toBe('Deleted user');

    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    expect(
      document.components?.schemas?.HotelReviewListItemResponseDto,
    ).toHaveProperty('properties.authorName');
    for (const operation of [
      document.paths['/api/hotel-bookings/{id}/review']?.post,
      document.paths['/api/hotels/{id}/reviews']?.get,
      document.paths['/api/reviews/{id}']?.patch,
      document.paths['/api/reviews/{id}']?.delete,
    ]) {
      expect(operation?.parameters).toContainEqual(
        expect.objectContaining({
          name: 'id',
          in: 'path',
          schema: { type: 'string' },
        }),
      );
    }
  });

  it('returns 404 for a missing public hotel and validates pagination', async () => {
    const missingHotel = new Types.ObjectId().toString();
    const missing = await t.http().get(`/api/hotels/${missingHotel}/reviews`);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe(ErrorCode.NotFound);

    const invalidPage = await t.http().get(`${URL}?page=0`);
    expect(invalidPage.status).toBe(400);
    expect(invalidPage.body.code).toBe(ErrorCode.ValidationFailed);
  });
});
