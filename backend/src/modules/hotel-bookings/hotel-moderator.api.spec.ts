import { NotImplementedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeAccountsService } from '../../../test/fakes/accounts.fake.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { daysBetween, toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelModeratorService } from './hotel-moderator.service.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1aa01';
const OTHER_HOTEL = '6553a1f0c2b4e8a9d0f1aa02';
const ROOM = '6553a1f0c2b4e8a9d0f1aa11';
const INACTIVE_ROOM = '6553a1f0c2b4e8a9d0f1aa12';
const GUEST = '6553a1f0c2b4e8a9d0f1aa21';
const SECOND_GUEST = '6553a1f0c2b4e8a9d0f1aa22';
const REFERENCE = 'HRABC234';
const RANGE = { from: '2027-03-10', to: '2027-03-12' };
const endpoint = (name: string, hotelId = HOTEL) =>
  `/api/hotels/${hotelId}/${name}`;

describe('Hotel moderator views (HTL-22, HTL-08)', () => {
  let t: TestApp;
  let model: Model<HotelReservation>;
  let service: HotelModeratorService;
  let cookie: string;
  const hotels = new FakeHotelsService();
  const accounts = new FakeAccountsService([
    { id: GUEST, name: 'Guest One', email: 'one@test.local' },
    { id: SECOND_GUEST, name: 'Guest Two', email: 'two@test.local' },
  ]);

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(HotelsService)
          .useValue(hotels)
          .overrideProvider(AccountsService)
          .useValue(accounts)
          .overrideProvider(RoomNightInventory)
          .useValue(new FakeRoomNightInventory(hotels)),
    });
    model = t.moduleRef.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
    service = t.moduleRef.get(HotelModeratorService);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCollections(t.connection);
    hotels.data.hotels = [HOTEL, OTHER_HOTEL].map((id) => ({
      id,
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
    }));
    hotels.data.rooms = [ROOM, INACTIVE_ROOM].map((id) => ({
      id,
      hotelId: HOTEL,
      name: id === ROOM ? '101' : '102',
      type: 'Double',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightMinor: 10_000,
      isActive: id === ROOM,
      availability: [
        {
          fromDate: toDateOnly('2027-03-10'),
          toDate: toDateOnly('2027-03-12'),
        },
      ],
      hasEverBeenReserved: false,
    }));
    hotels.data.roomNights = [];
    cookie = (
      await loginAs(t.connection, UserRole.HOTEL_MODERATOR, {
        providerId: HOTEL,
      })
    ).cookie;
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function reservation(
    status: HotelReservationStatus = HotelReservationStatus.CONFIRMED,
    hotelId = HOTEL,
    userId = GUEST,
    checkInDate = '2027-03-10',
  ) {
    const checkIn = toDateOnly(checkInDate);
    const checkOut = toDateOnly('2027-03-15');
    const nights = daysBetween(checkIn, checkOut);
    return model.create({
      userId: new Types.ObjectId(userId),
      hotelId: new Types.ObjectId(hotelId),
      status,
      ...(status === HotelReservationStatus.CONFIRMED
        ? { reference: REFERENCE }
        : {}),
      checkInDate: checkIn,
      checkOutDate: checkOut,
      nights,
      rooms: [
        {
          roomId: new Types.ObjectId(ROOM),
          roomName: '101',
          roomType: 'Double',
          pricePerNightMinor: 10_000,
          adults: 1,
          childAges: [7],
          subtotalMinor: nights * 10_000,
        },
      ],
      totalMinor: nights * 10_000,
      currency: 'USD',
      policySnapshot: {
        cancellationTiers: [],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      holdExpiresAt: new Date(Date.now() + 600_000),
    });
  }

  it('integration: scopes and paginates every reservation status by check-in date then ID', async () => {
    const statuses = Object.values(HotelReservationStatus);
    const records = [];
    for (const status of statuses) records.push(await reservation(status));
    await reservation(
      HotelReservationStatus.PENDING_PAYMENT,
      OTHER_HOTEL,
      SECOND_GUEST,
    );
    const page = await service.listReservations(
      HOTEL,
      { page: 2, limit: 2 },
      HOTEL,
    );
    expect(page).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3 });
    expect(page.items.map((row) => row._id)).toEqual(
      records.slice(2, 4).map((row) => row._id.toString()),
    );
    const all = await service.listReservations(
      HOTEL,
      { page: 1, limit: 10 },
      HOTEL,
    );
    expect(all.items.map((row) => row.status)).toEqual(statuses);
    const beyond = await service.listReservations(
      HOTEL,
      { page: 4, limit: 2 },
      HOTEL,
    );
    expect(beyond).toEqual({
      items: [],
      page: 4,
      limit: 2,
      total: 5,
      totalPages: 3,
    });
  });

  it('returns exactly guest identity, calendar dates, status and reference over HTTP', async () => {
    const record = await reservation();
    const res = await t
      .http()
      .get(endpoint('reservations'))
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          _id: record._id.toString(),
          reference: REFERENCE,
          guest: { _id: GUEST, name: 'Guest One' },
          checkInDate: '2027-03-10',
          checkOutDate: '2027-03-15',
          status: 'confirmed',
        },
      ],
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('integration: sorts earlier check-ins first and keeps missing account identity without inventing a name', async () => {
    const later = await reservation(
      HotelReservationStatus.PENDING_PAYMENT,
      HOTEL,
      new Types.ObjectId().toString(),
      '2027-03-12',
    );
    const earlier = await reservation(HotelReservationStatus.EXPIRED);
    const page = await service.listReservations(
      HOTEL,
      new PaginationQueryDto(),
      HOTEL,
    );
    expect(page.items.map((row) => row._id)).toEqual([
      earlier._id.toString(),
      later._id.toString(),
    ]);
    expect(page.items[1]?.guest).toEqual({ _id: later.userId.toString() });
    expect(page.items[1]).not.toHaveProperty('reference');
  });

  it('returns an empty paginated reservation list for a hotel with no reservations', async () => {
    const res = await t
      .http()
      .get(endpoint('reservations'))
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('integration: joins confirmed and pending nights and includes both boundaries without writing', async () => {
    const confirmed = await reservation();
    const pending = await reservation(HotelReservationStatus.PENDING_PAYMENT);
    hotels.data.roomNights = [
      {
        hotelId: HOTEL,
        roomId: ROOM,
        date: toDateOnly(RANGE.from),
        kind: 'reservation',
        reservationId: confirmed._id.toString(),
      },
      {
        hotelId: HOTEL,
        roomId: ROOM,
        date: toDateOnly('2027-03-11'),
        kind: 'reservation',
        reservationId: pending._id.toString(),
      },
      {
        hotelId: HOTEL,
        roomId: ROOM,
        date: toDateOnly(RANGE.to),
        kind: 'blocked',
        blockId: new Types.ObjectId().toString(),
      },
      {
        hotelId: HOTEL,
        roomId: ROOM,
        date: toDateOnly('2027-03-13'),
        kind: 'blocked',
        blockId: new Types.ObjectId().toString(),
      },
    ];
    const before = structuredClone(hotels.data);
    const page = await service.availability(
      HOTEL,
      { ...RANGE, page: 1, limit: 1 },
      HOTEL,
    );
    expect(page).toEqual({
      items: [
        {
          _id: ROOM,
          name: '101',
          type: 'Double',
          isActive: true,
          nights: [
            {
              date: RANGE.from,
              status: 'booked',
              reservationId: confirmed._id.toString(),
              reference: REFERENCE,
            },
            {
              date: '2027-03-11',
              status: 'booked',
              reservationId: pending._id.toString(),
            },
            { date: RANGE.to, status: 'blocked', reason: 'blocked_range' },
          ],
        },
      ],
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(hotels.data).toEqual(before);
    expect(await model.countDocuments()).toBe(2);
  });

  it('returns available dates, inactive rooms and out-of-range dates with explicit blocking reasons', async () => {
    const res = await t
      .http()
      .get(endpoint('availability'))
      .query({ from: '2027-03-09', to: '2027-03-13' })
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.items[0].nights).toEqual([
      { date: '2027-03-09', status: 'blocked', reason: 'outside_availability' },
      ...['10', '11', '12'].map((day) => ({
        date: `2027-03-${day}`,
        status: 'available',
      })),
      { date: '2027-03-13', status: 'blocked', reason: 'outside_availability' },
    ]);
    expect(res.body.items[1].nights).toHaveLength(5);
    expect(
      res.body.items[1].nights.every(
        (night: { status: string; reason: string }) =>
          night.status === 'blocked' && night.reason === 'inactive_room',
      ),
    ).toBe(true);
  });

  it('accepts a single inclusive night and pages rooms, retaining totals beyond the last page', async () => {
    const res = await t
      .http()
      .get(endpoint('availability'))
      .query({ from: RANGE.from, to: RANGE.from, page: 2, limit: 1 })
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(res.body.items[0]._id).toBe(INACTIVE_ROOM);
    expect(res.body.items[0].nights).toEqual([
      { date: RANGE.from, status: 'blocked', reason: 'inactive_room' },
    ]);
    const beyond = await service.availability(
      HOTEL,
      { ...RANGE, page: 3, limit: 1 },
      HOTEL,
    );
    expect(beyond).toEqual({
      items: [],
      page: 3,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('uses canonical hotel IDs when reading inventory, including uppercase HTTP IDs', async () => {
    const booked = await reservation();
    hotels.data.roomNights.push({
      hotelId: HOTEL,
      roomId: ROOM,
      date: toDateOnly(RANGE.from),
      kind: 'reservation',
      reservationId: booked._id.toString(),
    });
    const res = await t
      .http()
      .get(endpoint('availability', HOTEL.toUpperCase()))
      .query(RANGE)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.items[0].nights[0]).toMatchObject({
      status: 'booked',
      reference: REFERENCE,
    });
  });

  it('rejects an inventory reservation from another hotel rather than leaking its reference', async () => {
    const other = await reservation(
      HotelReservationStatus.CONFIRMED,
      OTHER_HOTEL,
    );
    hotels.data.roomNights.push({
      hotelId: HOTEL,
      roomId: ROOM,
      date: toDateOnly(RANGE.from),
      kind: 'reservation',
      reservationId: other._id.toString(),
    });
    const res = await t
      .http()
      .get(endpoint('availability'))
      .query(RANGE)
      .set('Cookie', cookie);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe(ErrorCode.InventoryCorrupted);
    expect(res.body).not.toHaveProperty('reference');
  });

  it('does not turn unavailable dependency methods into an empty successful response', async () => {
    vi.spyOn(hotels, 'getRoomNights').mockRejectedValueOnce(
      new NotImplementedException(),
    );
    await expect(
      service.availability(HOTEL, { ...RANGE, page: 1, limit: 10 }, HOTEL),
    ).rejects.toBeInstanceOf(NotImplementedException);
    await reservation();
    vi.spyOn(accounts, 'getProfiles').mockRejectedValueOnce(
      new NotImplementedException(),
    );
    await expect(
      service.listReservations(HOTEL, new PaginationQueryDto(), HOTEL),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  describe.each(['reservations', 'availability'])(
    '%s access and validation',
    (name) => {
      const query = name === 'availability' ? RANGE : {};
      it('rejects unauthenticated requests with 401', async () => {
        const res = await t.http().get(endpoint(name)).query(query);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
      });

      it.each([UserRole.USER, UserRole.ADMIN, UserRole.AIRLINE_MODERATOR])(
        'rejects %s with 403',
        async (role) => {
          const other = await loginAs(t.connection, role);
          const res = await t
            .http()
            .get(endpoint(name))
            .query(query)
            .set('Cookie', other.cookie);
          expect(res.status).toBe(403);
          expect(res.body.code).toBe(ErrorCode.ForbiddenRole);
        },
      );

      it.each([OTHER_HOTEL, '6553a1f0c2b4e8a9d0f1aaff'])(
        'rejects another or missing hotel %s with 404',
        async (hotelId) => {
          const res = await t
            .http()
            .get(endpoint(name, hotelId))
            .query(query)
            .set('Cookie', cookie);
          expect(res.status).toBe(404);
          expect(res.body.code).toBe(ErrorCode.NotFound);
        },
      );

      it('rejects a missing assigned hotel even when the assignment matches', async () => {
        hotels.data.hotels = [];
        const res = await t
          .http()
          .get(endpoint(name))
          .query(query)
          .set('Cookie', cookie);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(ErrorCode.NotFound);
      });

      it.each([
        { page: 0 },
        { limit: 51 },
        { page: 'x' },
        { providerId: OTHER_HOTEL },
      ])('rejects invalid pagination or injected scope %j', async (invalid) => {
        const res = await t
          .http()
          .get(endpoint(name))
          .query({ ...query, ...invalid })
          .set('Cookie', cookie);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
        expect(res.body.details.length).toBeGreaterThan(0);
      });

      it('rejects a malformed hotel ID with 400', async () => {
        const res = await t
          .http()
          .get(endpoint(name, 'not-an-id'))
          .query(query)
          .set('Cookie', cookie);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
      });
    },
  );

  it.each([
    { to: RANGE.to },
    { from: RANGE.from },
    { from: '2027-02-30', to: RANGE.to },
    { from: RANGE.from, to: '2027-02-30' },
    { from: '2027-03-10T00:00:00Z', to: RANGE.to },
    { from: RANGE.to, to: RANGE.from },
  ])(
    'rejects invalid calendar date range %j with field details',
    async (query) => {
      const res = await t
        .http()
        .get(endpoint('availability'))
        .query(query)
        .set('Cookie', cookie);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.ValidationFailed);
      expect(res.body.details.length).toBeGreaterThan(0);
    },
  );

  it('integration: refuses a missing moderator assignment before reading any reservations', async () => {
    await expect(
      service.listReservations(HOTEL, new PaginationQueryDto(), undefined),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.listReservations('bad', new PaginationQueryDto(), HOTEL),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('documents both endpoints and their complete paginated response schemas in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    for (const [name, requirement] of [
      ['reservations', 'HTL-22'],
      ['availability', 'HTL-08'],
    ]) {
      const operation = document.paths[`/api/hotels/{id}/${name}`]?.get;
      expect(operation?.summary).toContain(requirement);
      for (const status of ['200', '400', '401', '403', '404'])
        expect(operation?.responses[status]).toBeDefined();
    }
    expect(
      document.components?.schemas?.ModeratorReservationsPageDto,
    ).toMatchObject({
      properties: {
        items: { type: 'array' },
        page: { type: 'number' },
        totalPages: { type: 'number' },
      },
    });
    expect(document.components?.schemas?.RoomNightStatusDto).toMatchObject({
      properties: {
        status: { enum: ['available', 'booked', 'blocked'] },
        reference: { type: 'string' },
      },
    });
  });
});
