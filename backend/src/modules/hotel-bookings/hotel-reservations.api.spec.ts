import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1a711';
const ROOM_101 = '6553a1f0c2b4e8a9d0f1a712';
const ROOM_102 = '6553a1f0c2b4e8a9d0f1a713';

function seededHotels(): FakeHotelsService {
  return new FakeHotelsService({
    hotels: [
      {
        id: HOTEL,
        name: 'Nile View',
        address: '1 Corniche',
        cityId: 'cairo',
        countryCode: 'EG',
        photos: [],
        amenities: [],
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationPolicy: {
          tiers: [{ daysBefore: 3, refundPercent: 50 }],
        },
        isActive: true,
        ratingSummary: { average: null, count: 0 },
      },
    ],
    rooms: [
      {
        id: ROOM_101,
        hotelId: HOTEL,
        name: '101',
        type: 'Double',
        beds: 1,
        maxOccupancy: 3,
        pricePerNightMinor: 10_000,
        isActive: true,
        availability: [
          {
            fromDate: toDateOnly('2026-01-01'),
            toDate: toDateOnly('2028-12-31'),
          },
        ],
        hasEverBeenReserved: false,
      },
      {
        id: ROOM_102,
        hotelId: HOTEL,
        name: '102',
        type: 'Suite',
        beds: 2,
        maxOccupancy: 4,
        pricePerNightMinor: 25_000,
        isActive: true,
        availability: [
          {
            fromDate: toDateOnly('2026-01-01'),
            toDate: toDateOnly('2028-12-31'),
          },
        ],
        hasEverBeenReserved: false,
      },
    ],
    roomNights: [],
  });
}

describe('GET /api/hotel-bookings & /api/hotel-bookings/:id (HTL-20)', () => {
  let t: TestApp;
  let reservations: Model<HotelReservation>;
  const hotels = new FakeHotelsService();

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
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    Object.assign(hotels, seededHotels());
    await clearCollections(t.connection);
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function seedReservation(options: {
    userId: string;
    status: HotelReservationStatus;
    checkInDate: string;
    checkOutDate: string;
    reference?: string;
    confirmedAt?: Date;
    expiredAt?: Date;
    completedAt?: Date;
    cancellation?: {
      cancelledAt: Date;
      cancelledBy: 'user';
      refundPercent: number;
      refundAmountMinor: number;
    };
  }) {
    const checkIn = toDateOnly(options.checkInDate);
    const checkOut = toDateOnly(options.checkOutDate);
    const nights = Math.round(
      (checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000),
    );
    return reservations.create({
      userId: new Types.ObjectId(options.userId),
      hotelId: new Types.ObjectId(HOTEL),
      ...(options.reference ? { reference: options.reference } : {}),
      status: options.status,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      nights,
      rooms: [
        {
          roomId: new Types.ObjectId(ROOM_101),
          roomName: '101',
          roomType: 'Double',
          pricePerNightMinor: 10_000,
          adults: 2,
          childAges: [7],
          subtotalMinor: nights * 10_000,
        },
      ],
      totalMinor: nights * 10_000,
      currency: 'USD',
      policySnapshot: {
        cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      holdExpiresAt: new Date('2028-03-01T10:10:00.000Z'),
      ...(options.confirmedAt ? { confirmedAt: options.confirmedAt } : {}),
      ...(options.expiredAt ? { expiredAt: options.expiredAt } : {}),
      ...(options.completedAt ? { completedAt: options.completedAt } : {}),
      ...(options.cancellation ? { cancellation: options.cancellation } : {}),
    });
  }

  it('requires authentication on list and detail endpoints', async () => {
    const id = new Types.ObjectId().toHexString();
    const listRes = await t.http().get('/api/hotel-bookings');
    expect(listRes.status).toBe(401);
    expect(listRes.body.code).toBe(ErrorCode.NotAuthenticated);

    const detailRes = await t.http().get(`/api/hotel-bookings/${id}`);
    expect(detailRes.status).toBe(401);
    expect(detailRes.body.code).toBe(ErrorCode.NotAuthenticated);
  });

  it('lists owner reservations across groups, defaults to upcoming, and hides other users', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const other = await loginAs(t.connection, UserRole.USER);

    const upcoming = await seedReservation({
      userId: owner.id,
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HRAPI001',
      checkInDate: '2028-04-10',
      checkOutDate: '2028-04-13',
      confirmedAt: new Date('2026-11-20T09:05:00.000Z'),
    });
    const pending = await seedReservation({
      userId: owner.id,
      status: HotelReservationStatus.PENDING_PAYMENT,
      checkInDate: '2028-05-01',
      checkOutDate: '2028-05-02',
    });
    const pastCompleted = await seedReservation({
      userId: owner.id,
      status: HotelReservationStatus.COMPLETED,
      reference: 'HRAPI002',
      checkInDate: '2026-01-10',
      checkOutDate: '2026-01-12',
      confirmedAt: new Date('2026-01-01T10:05:00.000Z'),
      completedAt: new Date('2026-01-13T00:00:00.000Z'),
    });
    const pastExpired = await seedReservation({
      userId: owner.id,
      status: HotelReservationStatus.EXPIRED,
      checkInDate: '2026-02-10',
      checkOutDate: '2026-02-12',
      expiredAt: new Date('2026-02-01T10:15:00.000Z'),
    });
    const cancelled = await seedReservation({
      userId: owner.id,
      status: HotelReservationStatus.CANCELLED,
      reference: 'HRAPI003',
      checkInDate: '2028-06-01',
      checkOutDate: '2028-06-03',
      confirmedAt: new Date('2026-11-20T08:00:00.000Z'),
      cancellation: {
        cancelledAt: new Date('2026-11-20T09:00:00.000Z'),
        cancelledBy: 'user',
        refundPercent: 50,
        refundAmountMinor: 10_000,
      },
    });
    const otherReservation = await seedReservation({
      userId: other.id,
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HROTH999',
      checkInDate: '2028-04-11',
      checkOutDate: '2028-04-12',
    });

    // Default group is upcoming
    const defaultRes = await t
      .http()
      .get('/api/hotel-bookings')
      .set('Cookie', owner.cookie);
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    expect(
      defaultRes.body.items.map(
        (i: { reservationId: string }) => i.reservationId,
      ),
    ).toEqual([upcoming._id.toHexString(), pending._id.toHexString()]);

    // Unconfirmed pending_payment reservation has no fabricated reference
    const pendingSummary = defaultRes.body.items[1];
    expect(pendingSummary.status).toBe('pending_payment');
    expect(pendingSummary.reference).toBeUndefined();
    expect(Object.hasOwn(pendingSummary, 'reference')).toBe(false);

    // Exact summary shape check
    expect(defaultRes.body.items[0]).toEqual({
      reservationId: upcoming._id.toHexString(),
      reference: 'HRAPI001',
      status: 'confirmed',
      hotelId: HOTEL,
      hotelName: 'Nile View',
      checkInDate: '2028-04-10',
      checkOutDate: '2028-04-13',
      nights: 3,
      rooms: [
        {
          roomId: ROOM_101,
          roomName: '101',
          roomType: 'Double',
          pricePerNightMinor: 10_000,
          adults: 2,
          childAges: [7],
          subtotalMinor: 30_000,
        },
      ],
      totalMinor: 30_000,
      currency: 'USD',
    });

    // Past group
    const pastRes = await t
      .http()
      .get('/api/hotel-bookings?group=past&page=1&limit=1')
      .set('Cookie', owner.cookie);
    expect(pastRes.status).toBe(200);
    expect(pastRes.body).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(pastRes.body.items[0].reservationId).toBe(
      pastExpired._id.toHexString(),
    );

    const pastPage2 = await t
      .http()
      .get('/api/hotel-bookings?group=past&page=2&limit=1')
      .set('Cookie', owner.cookie);
    expect(pastPage2.status).toBe(200);
    expect(pastPage2.body.items[0].reservationId).toBe(
      pastCompleted._id.toHexString(),
    );

    // Cancelled group
    const cancelledRes = await t
      .http()
      .get('/api/hotel-bookings?group=cancelled')
      .set('Cookie', owner.cookie);
    expect(cancelledRes.status).toBe(200);
    expect(cancelledRes.body.total).toBe(1);
    expect(cancelledRes.body.items[0].reservationId).toBe(
      cancelled._id.toHexString(),
    );

    // Another user's detail returns 404
    const crossUserDetail = await t
      .http()
      .get(`/api/hotel-bookings/${otherReservation._id.toHexString()}`)
      .set('Cookie', owner.cookie);
    expect(crossUserDetail.status).toBe(404);
    expect(crossUserDetail.body.code).toBe(ErrorCode.NotFound);
  });

  it('returns full reservation details without leaking internal fields', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const cancelled = await seedReservation({
      userId: owner.id,
      status: HotelReservationStatus.CANCELLED,
      reference: 'HRDET001',
      checkInDate: '2028-06-01',
      checkOutDate: '2028-06-03',
      confirmedAt: new Date('2026-11-20T08:00:00.000Z'),
      cancellation: {
        cancelledAt: new Date('2026-11-20T09:00:00.000Z'),
        cancelledBy: 'user',
        refundPercent: 50,
        refundAmountMinor: 10_000,
      },
    });
    const pending = await seedReservation({
      userId: owner.id,
      status: HotelReservationStatus.PENDING_PAYMENT,
      checkInDate: '2028-07-01',
      checkOutDate: '2028-07-02',
    });

    const detailRes = await t
      .http()
      .get(`/api/hotel-bookings/${cancelled._id.toHexString()}`)
      .set('Cookie', owner.cookie);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body).toMatchObject({
      reservationId: cancelled._id.toHexString(),
      reference: 'HRDET001',
      status: 'cancelled',
      hotelId: HOTEL,
      hotelName: 'Nile View',
      checkInDate: '2028-06-01',
      checkOutDate: '2028-06-03',
      nights: 2,
      totalMinor: 20_000,
      currency: 'USD',
      policy: {
        cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      holdExpiresAt: '2028-03-01T10:10:00.000Z',
      confirmedAt: '2026-11-20T08:00:00.000Z',
      cancellation: {
        cancelledAt: '2026-11-20T09:00:00.000Z',
        cancelledBy: 'user',
        refundPercent: 50,
        refundAmountMinor: 10_000,
      },
    });
    expect(Number.isInteger(detailRes.body.totalMinor)).toBe(true);
    expect(typeof detailRes.body.createdAt).toBe('string');
    expect(typeof detailRes.body.updatedAt).toBe('string');
    expect(detailRes.body.userId).toBeUndefined();
    expect(detailRes.body._id).toBeUndefined();
    expect(detailRes.body.rooms[0]._id).toBeUndefined();

    const pendingDetail = await t
      .http()
      .get(`/api/hotel-bookings/${pending._id.toHexString()}`)
      .set('Cookie', owner.cookie);
    expect(pendingDetail.status).toBe(200);
    expect(pendingDetail.body.reference).toBeUndefined();
    expect(Object.hasOwn(pendingDetail.body, 'reference')).toBe(false);
  });

  it('follows owner-only access without role overrides for admins or moderators', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const owned = await seedReservation({
      userId: owner.id,
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HROWN999',
      checkInDate: '2028-04-10',
      checkOutDate: '2028-04-12',
    });

    for (const role of [
      UserRole.ADMIN,
      UserRole.AIRLINE_MODERATOR,
      UserRole.HOTEL_MODERATOR,
    ]) {
      const account = await loginAs(t.connection, role);
      const listRes = await t
        .http()
        .get('/api/hotel-bookings')
        .set('Cookie', account.cookie);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });

      const detailRes = await t
        .http()
        .get(`/api/hotel-bookings/${owned._id.toHexString()}`)
        .set('Cookie', account.cookie);
      expect(detailRes.status).toBe(404);
      expect(detailRes.body.code).toBe(ErrorCode.NotFound);
    }
  });

  it('rejects invalid id, group, pagination, and unknown query parameters with 400 VALIDATION_FAILED', async () => {
    const user = await loginAs(t.connection, UserRole.USER);

    const invalidId = await t
      .http()
      .get('/api/hotel-bookings/not-an-object-id')
      .set('Cookie', user.cookie);
    expect(invalidId.status).toBe(400);
    expect(invalidId.body.code).toBe(ErrorCode.ValidationFailed);

    for (const query of [
      'group=all',
      'group=',
      'page=0',
      'page=abc',
      'limit=0',
      'limit=51',
      'extra=1',
    ]) {
      const res = await t
        .http()
        .get(`/api/hotel-bookings?${query}`)
        .set('Cookie', user.cookie);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.ValidationFailed);
    }
  });

  it('documents HTL-20 endpoints in Swagger while preserving POST /api/hotel-bookings', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );

    const holdOp = document.paths['/api/hotel-bookings']?.post;
    expect(holdOp?.summary).toMatch(/^HTL-16 /);
    expect(holdOp?.responses['201']).toBeDefined();

    const listOp = document.paths['/api/hotel-bookings']?.get;
    expect(listOp?.summary).toMatch(/^HTL-20 /);
    expect(listOp?.responses['200']).toBeDefined();

    const detailOp = document.paths['/api/hotel-bookings/{id}']?.get;
    expect(detailOp?.summary).toMatch(/^HTL-20 /);
    expect(detailOp?.responses['200']).toBeDefined();
    expect(detailOp?.responses['404']).toBeDefined();
  });
});
