import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelReservation } from './schemas/hotel-reservation.schema.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1a701';
const ROOM = '6553a1f0c2b4e8a9d0f1a702';
const SUITE = '6553a1f0c2b4e8a9d0f1a703';

const hotels = new FakeHotelsService({
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
      cancellationPolicy: { tiers: [] },
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    },
  ],
  rooms: [ROOM, SUITE].map((id, i) => ({
    id,
    hotelId: HOTEL,
    name: `10${i + 1}`,
    type: 'Double',
    beds: 1,
    maxOccupancy: 2,
    pricePerNightMinor: 10_000,
    isActive: true,
    availability: [
      { fromDate: toDateOnly('2027-01-01'), toDate: toDateOnly('2027-12-31') },
    ],
    hasEverBeenReserved: false,
  })),
  roomNights: [],
});

const body = (roomId = ROOM, adults = 2) => ({
  hotelId: HOTEL,
  checkInDate: '2027-03-10',
  checkOutDate: '2027-03-12',
  rooms: [{ roomId, adults, childAges: [] }],
});

const URL = '/api/hotel-bookings';

describe('POST /api/hotel-bookings (HTL-16, HTL-18)', () => {
  let t: TestApp;
  let reservations: Model<HotelReservation>;

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

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('answers 201 with the hold, owned by the logged-in user', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const res = await t
      .http()
      .post(URL)
      .set('Cookie', user.cookie)
      .send(body());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'pending_payment',
      hotelId: HOTEL,
      hotelName: 'Nile View',
      checkInDate: '2027-03-10',
      checkOutDate: '2027-03-12',
      nights: 2,
      totalMinor: 20_000,
      currency: 'USD',
    });
    expect(res.body.reservationId).toMatch(/^[0-9a-f]{24}$/);
    expect(new Date(res.body.holdExpiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    const saved = await reservations.findById(res.body.reservationId).lean();
    expect(saved?.userId.toString()).toBe(user.id);
    expect(saved?.status).toBe('pending_payment');
  });

  it('rejects a userId in the body: the owner comes only from the session', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const res = await t
      .http()
      .post(URL)
      .set('Cookie', user.cookie)
      .send({ ...body(SUITE), userId: '6553a1f0c2b4e8a9d0f1a7ff' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.ValidationFailed);
  });

  // endpoints.md: the hold is for users; admins never modify bookings (auth.md).
  it.each([
    UserRole.ADMIN,
    UserRole.AIRLINE_MODERATOR,
    UserRole.HOTEL_MODERATOR,
  ])('answers 403 FORBIDDEN_ROLE for %s', async (role) => {
    const account = await loginAs(t.connection, role);
    const res = await t
      .http()
      .post(URL)
      .set('Cookie', account.cookie)
      .send(body(SUITE));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.ForbiddenRole);
  });

  it('answers 401 NOT_AUTHENTICATED without a login', async () => {
    const res = await t.http().post(URL).send(body(SUITE));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
  });

  it('answers 400 with field details when a room is over its occupancy', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const res = await t
      .http()
      .post(URL)
      .set('Cookie', user.cookie)
      .send(body(SUITE, 3)); // the room sleeps 2

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.ValidationFailed);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'rooms[0]' })]),
    );
  });

  it('answers 409 ROOMS_UNAVAILABLE when the room is already held for those nights', async () => {
    const first = await loginAs(t.connection, UserRole.USER);
    const second = await loginAs(t.connection, UserRole.USER);
    const sameNights = {
      ...body(SUITE),
      checkInDate: '2027-06-10',
      checkOutDate: '2027-06-12',
    };

    const won = await t
      .http()
      .post(URL)
      .set('Cookie', first.cookie)
      .send(sameNights);
    const lost = await t
      .http()
      .post(URL)
      .set('Cookie', second.cookie)
      .send(sameNights);

    expect(won.status).toBe(201);
    expect(lost.status).toBe(409);
    expect(lost.body.code).toBe(ErrorCode.RoomsUnavailable);
  });

  it('is documented in Swagger with its requirement ID', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operation = document.paths['/api/hotel-bookings']?.post;
    expect(operation?.summary).toMatch(/^HTL-16 /);
    expect(operation?.responses['201']).toBeDefined();
  });
});
