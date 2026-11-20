import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
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
import { HotelReviewsService } from './hotel-reviews.service.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1b101';
const ROOM = '6553a1f0c2b4e8a9d0f1b102';

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

describe('HotelReviewsService', () => {
  let t: TestApp;
  let reservations: Model<HotelReservation>;
  let service: HotelReviewsService;
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
    service = t.moduleRef.get(HotelReviewsService);
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

  it('recomputes the summary after create, edit, hide, owner delete, and admin delete', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const reservation1 = await seedReservation(owner.id);
    const reservation2 = await seedReservation(owner.id);
    const first = await service.create(reservation1._id.toString(), owner.id, {
      rating: 4,
    });
    const second = await service.create(reservation2._id.toString(), owner.id, {
      rating: 5,
      text: 'Wonderful stay',
    });
    expect(hotels.data.hotels[0]?.ratingSummary).toEqual({
      average: 4.5,
      count: 2,
    });

    await service.update(first._id, owner.id, {
      rating: 3,
      text: 'Updated review',
    });
    expect(hotels.data.hotels[0]?.ratingSummary).toEqual({
      average: 4,
      count: 2,
    });

    const reviews = registry.get(ReportTargetType.REVIEW);
    expect(await reviews.exists(second._id)).toBe(true);
    await reviews.hide(second._id);
    expect(hotels.data.hotels[0]?.ratingSummary).toEqual({
      average: 3,
      count: 1,
    });
    await reviews.hide(second._id);
    expect(hotels.data.hotels[0]?.ratingSummary).toEqual({
      average: 3,
      count: 1,
    });

    await service.delete(first._id, owner.id);
    expect(hotels.data.hotels[0]?.ratingSummary).toEqual({
      average: null,
      count: 0,
    });

    const reservation3 = await seedReservation(owner.id);
    const third = await service.create(reservation3._id.toString(), owner.id, {
      rating: 2,
    });
    await reviews.delete(third._id);
    expect(hotels.data.hotels[0]?.ratingSummary).toEqual({
      average: null,
      count: 0,
    });
    expect(await reviews.exists('not-an-id')).toBe(false);
  });

  it('lists only visible reviews, newest first, with standard pagination', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const reservation1 = await seedReservation(owner.id);
    const reservation2 = await seedReservation(owner.id);
    const first = await service.create(reservation1._id.toString(), owner.id, {
      rating: 3,
    });
    const second = await service.create(reservation2._id.toString(), owner.id, {
      rating: 5,
      text: 'Newest',
    });

    const page = await service.listForHotel(HOTEL, { page: 1, limit: 1 });
    expect(page).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(page.items[0]?._id).toBe(second._id);

    await registry.get(ReportTargetType.REVIEW).hide(second._id);
    const visible = await service.listForHotel(HOTEL);
    expect(visible.items.map((review) => review._id)).toEqual([first._id]);
    expect(visible.total).toBe(1);
  });

  it('enforces ownership, completion, pagination, and missing-resource errors', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const other = await loginAs(t.connection, UserRole.USER);
    const completed = await seedReservation(owner.id);
    const pending = await seedReservation(
      owner.id,
      HotelReservationStatus.PENDING_PAYMENT,
    );
    const review = await service.create(completed._id.toString(), owner.id, {
      rating: 4,
    });

    await expect(
      service.create(completed._id.toString(), other.id, { rating: 5 }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
    await expect(
      service.create(pending._id.toString(), owner.id, { rating: 5 }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.InvalidStatusTransition },
    });
    await expect(
      service.update(review._id, other.id, { rating: 2 }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
    await expect(service.delete(review._id, other.id)).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
    await expect(
      service.update(review._id, owner.id, {}),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.ValidationFailed },
    });
    await expect(
      service.listForHotel(HOTEL, { page: 0, limit: 10 }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.ValidationFailed },
    });
    await expect(
      service.listForHotel(new Types.ObjectId().toString()),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
    await expect(service.listForHotel('not-an-id')).rejects.toMatchObject({
      response: { code: ErrorCode.ValidationFailed },
    });
    await expect(
      registry
        .get(ReportTargetType.REVIEW)
        .hide(new Types.ObjectId().toString()),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
    await expect(
      registry.get(ReportTargetType.REVIEW).delete('not-an-id'),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
  });

  it('returns ALREADY_REVIEWED when a reservation already has a review', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const reservation = await seedReservation(owner.id);
    await service.create(reservation._id.toString(), owner.id, { rating: 4 });

    await expect(
      service.create(reservation._id.toString(), owner.id, { rating: 5 }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.AlreadyReviewed },
    });
  });
});
