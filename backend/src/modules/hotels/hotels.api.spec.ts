import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { imageBytes } from '../../../test/support/image-fixtures.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { MAX_PRICE_MINOR } from '../../common/money/money.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { Role } from '../accounts/auth/auth.types.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { MAX_IMAGE_BYTES } from '../storage/image-rules.js';
import { StorageService } from '../storage/storage.service.js';
import { HotelsModule } from './hotels.module.js';
import { HotelsService } from './hotels.service.js';
import { RoomNightInventory } from './room-night-inventory.js';
import { Hotel } from './schemas/hotel.schema.js';
import { Room } from './schemas/room.schema.js';
import { RoomNight } from './schemas/room-night.schema.js';

const profile = {
  name: 'Nile View Hotel',
  address: '1 Corniche El Nil',
  cityId: 'cairo',
  description: 'A hotel by the Nile',
  starRating: 4,
  amenities: ['Wi-Fi', 'Pool'],
};

describe('Hotels API (HTL-01 / HTL-03 / HTL-06)', () => {
  let t: TestApp;
  let service: HotelsService;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let nights: Model<RoomNight>;
  let inventory: RoomNightInventory;
  const storage = new FakeStorageService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService())
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    service = t.moduleRef.get(HotelsService);
    hotels = t.moduleRef.get<Model<Hotel>>(getModelToken(Hotel.name));
    rooms = t.moduleRef.get<Model<Room>>(getModelToken(Room.name));
    nights = t.moduleRef.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    inventory = t.moduleRef.get(RoomNightInventory);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCollections(t.connection);
    await Promise.all(storage.keys().map((key) => storage.delete(key)));
  });
  afterAll(() => t.close(), HOOK_TIMEOUT);

  describe('public hotel details and free rooms (HTL-02 / HTL-15)', () => {
    const dates = { checkIn: '2099-12-01', checkOut: '2099-12-04' };

    async function fixture() {
      const hotel = await service.create(profile);
      const room = await rooms.create({
        hotelId: hotel.id,
        name: '101',
        type: 'Deluxe King',
        beds: 2,
        maxOccupancy: 3,
        pricePerNightMinor: 12345,
        availability: [
          {
            fromDate: toDateOnly(dates.checkIn),
            toDate: toDateOnly('2099-12-03'),
          },
        ],
      });
      return { hotel, room };
    }

    it('returns the exact public profile with photo URLs, policies and an unrated summary without dates or login', async () => {
      const { hotel } = await fixture();
      const photoId = new Types.ObjectId();
      await hotels.updateOne(
        { _id: hotel.id },
        {
          $set: {
            photos: [{ _id: photoId, key: 'hotel.jpg' }],
            checkInTime: '15:30',
            checkOutTime: '11:00',
            cancellationPolicy: {
              tiers: [{ daysBefore: 7, refundPercent: 80 }],
            },
          },
        },
      );
      const response = await t
        .http()
        .get(`/api/hotels/${hotel.id}`)
        .expect(200);
      expect(response.body).toEqual({
        _id: hotel.id,
        ...profile,
        countryCode: 'EG',
        photos: [
          {
            _id: photoId.toHexString(),
            key: 'hotel.jpg',
            url: '/uploads/hotel.jpg',
          },
        ],
        checkInTime: '15:30',
        checkOutTime: '11:00',
        cancellationPolicy: { tiers: [{ daysBefore: 7, refundPercent: 80 }] },
        isActive: true,
        ratingSummary: { average: null, count: 0 },
      });
    });

    it('allows registered users to read the stored guest rating and dated rooms with exact prices', async () => {
      const { hotel, room } = await fixture();
      await hotels.updateOne(
        { _id: hotel.id },
        {
          $set: { ratingSummary: { average: 4.6, count: 23 } },
        },
      );
      const user = await loginAs(t.connection, Role.USER);
      const details = await t
        .http()
        .get(`/api/hotels/${hotel.id}`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(details.body.ratingSummary).toEqual({ average: 4.6, count: 23 });
      const response = await t
        .http()
        .get(`/api/hotels/${hotel.id}/rooms/available`)
        .set('Cookie', user.cookie)
        .query(dates)
        .expect(200);
      expect(response.body).toEqual({
        items: [
          {
            _id: room._id.toHexString(),
            hotelId: hotel.id,
            name: '101',
            type: 'Deluxe King',
            beds: 2,
            maxOccupancy: 3,
            pricePerNightMinor: 12345,
            totalMinor: 37035,
          },
        ],
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      const guest = await t
        .http()
        .get(`/api/hotels/${hotel.id}/rooms/available`)
        .query(dates)
        .expect(200);
      expect(guest.body).toEqual(response.body);
    });

    it('returns only free rooms, uses paginated list metadata, and does not hold inventory', async () => {
      const { hotel, room } = await fixture();
      await rooms.create({
        hotelId: hotel.id,
        name: '102',
        type: 'Single',
        beds: 1,
        maxOccupancy: 1,
        pricePerNightMinor: 9000,
        availability: room.availability,
      });
      const path = `/api/hotels/${hotel.id}/rooms/available`;
      const first = await t
        .http()
        .get(path)
        .query({ ...dates, limit: 1 })
        .expect(200);
      const second = await t
        .http()
        .get(path)
        .query({ ...dates, limit: 1, page: 2 })
        .expect(200);
      expect(first.body).toMatchObject({
        items: [{ _id: room._id.toHexString() }],
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(second.body).toMatchObject({
        items: [{ name: '102' }],
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(await nights.countDocuments()).toBe(0);
      await nights.create({
        hotelId: hotel.id,
        roomId: room._id,
        date: toDateOnly('2099-12-03'),
        kind: 'blocked',
        blockId: new Types.ObjectId(),
      });
      const filtered = await t.http().get(path).query(dates).expect(200);
      expect(filtered.body).toMatchObject({
        items: [{ name: '102' }],
        total: 1,
      });
      await rooms.updateMany(
        { hotelId: hotel.id },
        { $set: { isActive: false } },
      );
      const empty = await t.http().get(path).query(dates).expect(200);
      expect(empty.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('rejects missing, impossible, timestamp, past and reversed dates, invalid pagination and unknown query fields', async () => {
      const { hotel } = await fixture();
      const path = `/api/hotels/${hotel.id}/rooms/available`;
      for (const query of [
        {},
        { checkIn: dates.checkIn },
        { checkOut: dates.checkOut },
        { ...dates, checkIn: '2099-02-30' },
        { ...dates, checkOut: '2099-02-30' },
        { ...dates, checkIn: '2099-12-01T00:00:00Z' },
        { ...dates, checkIn: '2000-01-01' },
        { ...dates, checkOut: dates.checkIn },
        { ...dates, checkOut: '2099-11-30' },
        { ...dates, page: 0 },
        { ...dates, limit: 51 },
        { ...dates, limit: 1.5 },
        { ...dates, page: 1e100 },
        { ...dates, totalMinor: 1 },
        { ...dates, guests: 2 },
      ]) {
        const response = await t.http().get(path).query(query).expect(400);
        expect(response.body).toMatchObject({
          code: ErrorCode.ValidationFailed,
          details: expect.any(Array),
        });
      }
    });

    it('returns shared 400/404 errors for malformed and missing hotel IDs on both routes', async () => {
      for (const id of ['invalid', new Types.ObjectId().toHexString()]) {
        for (const suffix of ['', '/rooms/available']) {
          const response = await t
            .http()
            .get(`/api/hotels/${id}${suffix}`)
            .query(suffix ? dates : {})
            .expect(id === 'invalid' ? 400 : 404);
          expect(response.body.code).toBe(
            id === 'invalid' ? ErrorCode.ValidationFailed : ErrorCode.NotFound,
          );
        }
      }
    });

    it('documents both public operations, required dates, pagination and typed responses in Swagger', () => {
      const document = SwaggerModule.createDocument(
        t.app,
        new DocumentBuilder().addCookieAuth('access_token').build(),
      );
      const details = document.paths['/api/hotels/{id}']?.get;
      const available = document.paths['/api/hotels/{id}/rooms/available']?.get;
      expect(details).toMatchObject({
        security: [],
        summary: expect.stringContaining('HTL-02'),
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/HotelProfileResponseDto',
                },
              },
            },
          },
        },
      });
      expect(available).toMatchObject({
        security: [],
        summary: expect.stringContaining('HTL-15'),
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: 'checkIn', required: true }),
          expect.objectContaining({ name: 'checkOut', required: true }),
          expect.objectContaining({ name: 'limit' }),
        ]),
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PaginatedAvailableRoomsResponseDto',
                },
              },
            },
          },
        },
      });
      expect(
        document.components?.schemas?.AvailableRoomResponseDto,
      ).toMatchObject({
        properties: {
          _id: expect.any(Object),
          pricePerNightMinor: expect.any(Object),
          totalMinor: {
            type: 'integer',
            minimum: 1,
            description: expect.any(String),
          },
        },
      });
    });
  });

  describe('public hotel search (HTL-11 / HTL-12)', () => {
    const query = {
      cityId: 'cairo',
      checkIn: '2099-12-01',
      checkOut: '2099-12-04',
      guests: 2,
    };

    async function fixture() {
      const hotel = await service.create(profile);
      await rooms.create({
        hotelId: hotel.id,
        name: '101',
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 12345,
        availability: [
          {
            fromDate: toDateOnly(query.checkIn),
            toDate: toDateOnly('2099-12-03'),
          },
        ],
      });
      return hotel;
    }

    it('works without login, defaults to one room and returns the exact paginated HTTP shape', async () => {
      const hotel = await fixture();
      const response = await t
        .http()
        .get('/api/hotels/search')
        .query(query)
        .expect(200);
      expect(response.body).toEqual({
        items: [
          {
            _id: hotel.id,
            ...profile,
            countryCode: 'EG',
            photos: [],
            checkInTime: '14:00',
            checkOutTime: '12:00',
            cancellationPolicy: { tiers: [] },
            isActive: true,
            ratingSummary: { average: null, count: 0 },
            pricePerNightMinor: 12345,
          },
        ],
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });

    it('also works for a registered user with country, price, rating, sorting and pagination inputs', async () => {
      const hotel = await fixture();
      await hotels.updateOne(
        { _id: hotel.id },
        { $set: { ratingSummary: { average: 4.5, count: 2 } } },
      );
      const user = await loginAs(t.connection, Role.USER);
      const { cityId, ...dates } = query;
      void cityId;
      const response = await t
        .http()
        .get('/api/hotels/search')
        .set('Cookie', user.cookie)
        .query({
          ...dates,
          countryCode: 'EG',
          rooms: 1,
          minPrice: 12345,
          maxPrice: 12345,
          minRating: 4.5,
          sortBy: 'rating',
          sortOrder: 'desc',
          page: 1,
          limit: 1,
        })
        .expect(200);
      expect(response.body).toMatchObject({
        items: [{ _id: hotel.id, pricePerNightMinor: 12345 }],
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
      });
    });

    it('does not advertise or filter on a cheaper room that cannot accommodate the requested group', async () => {
      const hotel = await fixture();
      await rooms.create({
        hotelId: hotel.id,
        name: 'single',
        type: 'Single',
        beds: 1,
        maxOccupancy: 1,
        pricePerNightMinor: 100,
        availability: [
          {
            fromDate: toDateOnly(query.checkIn),
            toDate: toDateOnly('2099-12-03'),
          },
        ],
      });
      const result = await t
        .http()
        .get('/api/hotels/search')
        .query(query)
        .expect(200);
      expect(result.body.items[0]?.pricePerNightMinor).toBe(12345);
      const filtered = await t
        .http()
        .get('/api/hotels/search')
        .query({ ...query, maxPrice: 100 })
        .expect(200);
      expect(filtered.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('returns a successful empty page when availability or rating filters do not match', async () => {
      await fixture();
      for (const filter of [{ rooms: 2 }, { minRating: 1 }]) {
        const response = await t
          .http()
          .get('/api/hotels/search')
          .query({ ...query, ...filter })
          .expect(200);
        expect(response.body).toEqual({
          items: [],
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
        });
      }
    });

    it.each([
      ['cityId', { cityId: '' }],
      ['countryCode', { countryCode: 'EGP' }],
      ['checkIn', { checkIn: '2099-02-30' }],
      ['checkIn', { checkIn: '2099-12-01T00:00:00Z' }],
      ['checkIn', { checkIn: '2000-01-01' }],
      ['checkOut', { checkOut: '2099-12-01' }],
      ['guests', { guests: 0 }],
      ['guests', { guests: 1.5 }],
      ['rooms', { rooms: 0 }],
      ['minPrice', { minPrice: -1 }],
      ['minPrice', { minPrice: Number.MAX_SAFE_INTEGER + 1 }],
      ['maxPrice', { maxPrice: 1.5 }],
      ['maxPrice', { minPrice: 200, maxPrice: 100 }],
      ['minRating', { minRating: 0 }],
      ['minRating', { minRating: 5.1 }],
      ['sortBy', { sortBy: 'name' }],
      ['sortOrder', { sortOrder: 'invalid' }],
      ['page', { page: 0 }],
      ['limit', { limit: 51 }],
      ['unknown', { unknown: 'value' }],
    ] as const)(
      'returns 400 VALIDATION_FAILED with details for invalid %s',
      async (field, invalid) => {
        const response = await t
          .http()
          .get('/api/hotels/search')
          .query({ ...query, ...invalid })
          .expect(400);
        expect(response.body).toMatchObject({
          code: ErrorCode.ValidationFailed,
          details: expect.arrayContaining([expect.objectContaining({ field })]),
        });
      },
    );

    it('requires dates, guest count and a destination', async () => {
      const response = await t.http().get('/api/hotels/search').expect(400);
      expect(response.body).toMatchObject({
        code: ErrorCode.ValidationFailed,
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'checkIn' }),
          expect.objectContaining({ field: 'checkOut' }),
          expect.objectContaining({ field: 'guests' }),
        ]),
      });
      const { cityId, ...withoutDestination } = query;
      void cityId;
      const missingDestination = await t
        .http()
        .get('/api/hotels/search')
        .query(withoutDestination)
        .expect(400);
      expect(missingDestination.body).toMatchObject({
        code: ErrorCode.ValidationFailed,
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'cityId' }),
        ]),
      });
    });

    it('documents the public route, query defaults and paginated response in Swagger', () => {
      const document = SwaggerModule.createDocument(
        t.app,
        new DocumentBuilder().addCookieAuth('access_token').build(),
      );
      const route = document.paths['/api/hotels/search']?.get;
      expect(route).toMatchObject({
        security: [],
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: 'checkIn', required: true }),
          expect.objectContaining({
            name: 'rooms',
            schema: { default: 1, minimum: 1, type: 'integer' },
          }),
        ]),
      });
      expect(route?.responses['200']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/PaginatedHotelSearchResponseDto',
            },
          },
        },
      });
      expect(
        document.components?.schemas?.HotelSearchResponseDto,
      ).toMatchObject({
        properties: {
          _id: expect.any(Object),
          pricePerNightMinor: {
            type: 'integer',
            minimum: 1,
            description: expect.any(String),
          },
        },
      });
    });
  });

  describe('room availability and edit endpoints (HTL-04 / HTL-05)', () => {
    const range = { fromDate: '2099-12-01', toDate: '2099-12-05' };
    const operations = [
      { method: 'post', suffix: '/availability', body: range },
      {
        method: 'patch',
        suffix: '/availability',
        body: { op: 'SET_RANGES', ranges: [range] },
      },
      { method: 'patch', suffix: '', body: { beds: 2 } },
    ] as const;

    async function fixture() {
      const hotel = await service.create(profile);
      const room = await service.createRoom(
        hotel.id,
        {
          name: '101',
          type: 'Double',
          beds: 1,
          maxOccupancy: 2,
          pricePerNightMinor: 10000,
        },
        hotel.id,
      );
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: hotel.id,
      });
      return {
        hotel,
        room,
        cookie: moderator.cookie,
        path: `/api/hotels/${hotel.id}/rooms/${room.id}`,
      };
    }

    it('adds and replaces bookable ranges with inclusive, normalized calendar-date responses', async () => {
      const { path, cookie, room } = await fixture();
      const added = await t
        .http()
        .post(`${path}/availability`)
        .set('Cookie', cookie)
        .send(range)
        .expect(201);
      expect(added.body).toEqual({
        _id: room.id,
        hotelId: room.hotelId,
        name: room.name,
        type: room.type,
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10000,
        isActive: true,
        hasEverBeenReserved: false,
        availability: [range],
      });
      const replaced = await t
        .http()
        .patch(`${path}/availability`)
        .set('Cookie', cookie)
        .send({
          op: 'SET_RANGES',
          ranges: [
            { fromDate: '2099-12-12', toDate: '2099-12-12' },
            { fromDate: '2099-12-10', toDate: '2099-12-11' },
          ],
        })
        .expect(200);
      expect(replaced.body.availability).toEqual([
        { fromDate: '2099-12-10', toDate: '2099-12-12' },
      ]);
      const cleared = await t
        .http()
        .patch(`${path}/availability`)
        .set('Cookie', cookie)
        .send({ op: 'SET_RANGES', ranges: [] })
        .expect(200);
      expect(cleared.body.availability).toEqual([]);
    });

    it('partially edits only the allowed numeric room fields at their minimum boundaries', async () => {
      const { path, cookie, hotel, room } = await fixture();
      const updated = await t
        .http()
        .patch(path)
        .set('Cookie', cookie)
        .send({
          beds: 2,
          maxOccupancy: 4,
          pricePerNightMinor: 12000,
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        _id: room.id,
        hotelId: hotel.id,
        name: room.name,
        beds: 2,
        maxOccupancy: 4,
        pricePerNightMinor: 12000,
      });
      const partial = await t
        .http()
        .patch(path)
        .set('Cookie', cookie)
        .send({ pricePerNightMinor: 1 })
        .expect(200);
      expect(partial.body).toEqual({ ...updated.body, pricePerNightMinor: 1 });
    });

    it('requires login and the hotel-moderator role for all three operations', async () => {
      const { path } = await fixture();
      for (const operation of operations) {
        const response = await t
          .http()
          [operation.method](path + operation.suffix)
          .send(operation.body)
          .expect(401);
        expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
      }
      for (const role of [Role.USER, Role.ADMIN, Role.AIRLINE_MODERATOR]) {
        const user = await loginAs(t.connection, role);
        for (const operation of operations) {
          const response = await t
            .http()
            [operation.method](path + operation.suffix)
            .set('Cookie', user.cookie)
            .send(operation.body)
            .expect(403);
          expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
        }
      }
    });

    it('returns 404 for another hotel, a mismatched room and missing resources', async () => {
      const { path, hotel, room, cookie } = await fixture();
      const other = await service.create(profile);
      const otherModerator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: other.id,
      });
      const missing = new Types.ObjectId().toHexString();
      const missingModerator = await loginAs(
        t.connection,
        Role.HOTEL_MODERATOR,
        { providerId: missing },
      );
      for (const operation of operations) {
        for (const [base, auth] of [
          [path, otherModerator.cookie],
          [`/api/hotels/${other.id}/rooms/${room.id}`, otherModerator.cookie],
          [`/api/hotels/${hotel.id}/rooms/${missing}`, cookie],
          [`/api/hotels/${missing}/rooms/${room.id}`, missingModerator.cookie],
        ]) {
          const response = await t
            .http()
            [operation.method](base + operation.suffix)
            .set('Cookie', auth)
            .send(operation.body)
            .expect(404);
          expect(response.body.code).toBe(ErrorCode.NotFound);
        }
      }
      expect(await service.getRooms(hotel.id)).toEqual([room]);
    });

    it('rejects invalid calendar dates, reversed or overlapping ranges, and unsupported operations', async () => {
      const { path, cookie, hotel, room } = await fixture();
      const invalid = [
        {},
        { fromDate: '2099-02-30', toDate: '2099-03-01' },
        { ...range, fromDate: '2099-12-01T00:00:00Z' },
        { ...range, fromDate: null },
        { ...range, toDate: '2099-11-30' },
        { ...range, reservationId: new Types.ObjectId().toHexString() },
      ];
      for (const body of invalid) {
        for (const method of ['post', 'patch'] as const) {
          const response = await t
            .http()
            [method](`${path}/availability`)
            .set('Cookie', cookie)
            .send(
              method === 'post' ? body : { op: 'SET_RANGES', ranges: [body] },
            )
            .expect(400);
          expect(response.body.code).toBe(ErrorCode.ValidationFailed);
        }
      }
      for (const body of [
        {},
        { ranges: [] },
        { op: 'BLOCK', ranges: [] },
        { op: 'SET_RANGES', ranges: null },
        { op: 'SET_RANGES', ranges: [null] },
        { op: 'SET_RANGES', ranges: 'invalid' },
        { op: 'SET_RANGES', ranges: [range, range] },
      ]) {
        const response = await t
          .http()
          .patch(`${path}/availability`)
          .set('Cookie', cookie)
          .send(body)
          .expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
      expect(await service.getRooms(hotel.id)).toEqual([room]);
      await t
        .http()
        .post(`${path}/availability`)
        .set('Cookie', cookie)
        .send(range)
        .expect(201);
      const overlap = await t
        .http()
        .post(`${path}/availability`)
        .set('Cookie', cookie)
        .send({
          fromDate: '2099-12-05',
          toDate: '2099-12-07',
        })
        .expect(400);
      expect(overlap.body.code).toBe(ErrorCode.ValidationFailed);
    });

    it('validates edit bounds, nulls, numeric strings, protected fields and both route IDs', async () => {
      const { path, cookie, hotel, room } = await fixture();
      for (const field of ['beds', 'maxOccupancy', 'pricePerNightMinor']) {
        for (const value of [
          0,
          -1,
          1.5,
          '2',
          null,
          Number.MAX_SAFE_INTEGER + 1,
        ]) {
          const response = await t
            .http()
            .patch(path)
            .set('Cookie', cookie)
            .send({ [field]: value })
            .expect(400);
          expect(response.body).toMatchObject({
            code: ErrorCode.ValidationFailed,
            details: expect.arrayContaining([
              expect.objectContaining({ field }),
            ]),
          });
        }
      }
      for (const field of [
        'hotelId',
        'name',
        'type',
        'isActive',
        'availability',
        'inventoryVersion',
        'hasEverBeenReserved',
      ]) {
        const response = await t
          .http()
          .patch(path)
          .set('Cookie', cookie)
          .send({ beds: 2, [field]: 'spoofed' })
          .expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
      for (const base of [
        `/api/hotels/invalid/rooms/${room.id}`,
        `/api/hotels/${hotel.id}/rooms/invalid`,
      ]) {
        for (const operation of operations) {
          const response = await t
            .http()
            [operation.method](base + operation.suffix)
            .set('Cookie', cookie)
            .send(operation.body)
            .expect(400);
          expect(response.body.code).toBe(ErrorCode.ValidationFailed);
        }
      }
      expect(await service.getRooms(hotel.id)).toEqual([room]);
    });

    it('returns 409 AVAILABILITY_HAS_RESERVATIONS when a held night would be removed', async () => {
      const { path, cookie, hotel, room } = await fixture();
      await t
        .http()
        .post(`${path}/availability`)
        .set('Cookie', cookie)
        .send(range)
        .expect(201);
      const session = await t.connection.startSession();
      try {
        await session.withTransaction(() =>
          t.moduleRef
            .get(RoomNightInventory)
            .reserve(
              hotel.id,
              [room.id],
              toDateOnly('2099-12-01'),
              toDateOnly('2099-12-02'),
              new Types.ObjectId().toHexString(),
              { session },
            ),
        );
      } finally {
        await session.endSession();
      }
      const response = await t
        .http()
        .patch(`${path}/availability`)
        .set('Cookie', cookie)
        .send({ op: 'SET_RANGES', ranges: [] })
        .expect(409);
      expect(response.body.code).toBe(ErrorCode.AvailabilityHasReservations);
      expect((await service.getRooms(hotel.id))[0].availability).toEqual([
        {
          fromDate: toDateOnly(range.fromDate),
          toDate: toDateOnly(range.toDate),
        },
      ]);
    });

    it('documents all three operations, validated request bodies and room responses in Swagger', () => {
      const document = SwaggerModule.createDocument(
        t.app,
        new DocumentBuilder()
          .setTitle('Travel Platform API')
          .setVersion('0.0.1')
          .addCookieAuth('access_token')
          .build(),
      );
      const path = '/api/hotels/{id}/rooms/{roomId}';
      for (const [operation, status, request] of [
        [
          document.paths[`${path}/availability`]?.post,
          '201',
          'RoomAvailabilityDto',
        ],
        [
          document.paths[`${path}/availability`]?.patch,
          '200',
          'RoomAvailabilityOperationDto',
        ],
        [document.paths[path]?.patch, '200', 'PatchRoomDto'],
      ] as const) {
        expect(operation?.summary).toMatch(/HTL-04|HTL-05/);
        expect(operation?.security).toEqual([{ cookie: [] }]);
        for (const error of ['400', '401', '403', '404'])
          expect(operation?.responses[error]).toBeDefined();
        expect(operation?.requestBody).toMatchObject({
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${request}` },
            },
          },
        });
        const ok = operation?.responses[status] as unknown as {
          content: { 'application/json': { schema: Record<string, unknown> } };
        };
        const schema = ok.content['application/json'].schema;
        // The PATCH availability route also answers BLOCK/UNBLOCK (HTL-06).
        expect(
          schema.$ref ?? (schema.oneOf as { $ref: string }[])[0]?.$ref,
        ).toBe('#/components/schemas/RoomResponseDto');
      }
      expect(
        document.paths[`${path}/availability`]?.patch?.responses['409'],
      ).toBeDefined();
    });
  });

  describe('room management endpoints (HTL-06)', () => {
    let hotelId: string;
    let roomId: string;
    let path: string;
    let fromDate: Date;
    let toDate: Date;
    let blockBody: { op: 'BLOCK'; fromDate: string; toDate: string };
    const actions = ['BLOCK', 'UNBLOCK', 'DEACTIVATE', 'DELETE'] as const;
    type Action = (typeof actions)[number];

    beforeEach(async () => {
      hotelId = (await service.create(profile)).id;
      const today = toDateOnly(new Date().toISOString().slice(0, 10));
      fromDate = addDays(today, 2);
      toDate = addDays(today, 4);
      const room = await rooms.create({
        hotelId,
        name: '101',
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10000,
        availability: [{ fromDate: today, toDate: addDays(today, 30) }],
      });
      roomId = room._id.toHexString();
      path = `/api/hotels/${hotelId}/rooms/${roomId}`;
      blockBody = {
        op: 'BLOCK',
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
      };
    });

    function mutation(action: Action, target = path) {
      if (action === 'DELETE') return t.http().delete(target);
      if (action === 'DEACTIVATE')
        return t.http().patch(target).send({ isActive: false });
      return t
        .http()
        .patch(`${target}/availability`)
        .send(
          action === 'BLOCK'
            ? blockBody
            : { op: 'UNBLOCK', blockId: new Types.ObjectId().toHexString() },
        );
    }

    async function moderator() {
      return loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: hotelId,
      });
    }

    it('blocks inclusive dates, returns the block ID and removes exactly that block', async () => {
      const user = await moderator();
      const created = await mutation('BLOCK')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(created.body).toEqual({
        blockId: expect.stringMatching(/^[a-f0-9]{24}$/),
      });
      expect(
        await nights.countDocuments({ blockId: created.body.blockId }),
      ).toBe(3);
      const unblocked = await t
        .http()
        .patch(`${path}/availability`)
        .set('Cookie', user.cookie)
        .send({ op: 'UNBLOCK', blockId: created.body.blockId })
        .expect(200);
      expect(unblocked.body).toEqual(created.body);
      expect(await nights.countDocuments()).toBe(0);
    });

    it('rejects oversized blocks before inventory writes with a field-level validation error', async () => {
      const user = await moderator();
      const block = vi
        .spyOn(inventory, 'block')
        .mockResolvedValue(new Types.ObjectId().toHexString());
      for (const dates of [
        { fromDate: '2028-01-01', toDate: '2028-12-31' },
        { fromDate: '2030-01-01', toDate: '2999-12-31' },
      ]) {
        const response = await t
          .http()
          .patch(`${path}/availability`)
          .set('Cookie', user.cookie)
          .send({ op: 'BLOCK', ...dates })
          .expect(400);
        expect(response.body).toMatchObject({
          code: ErrorCode.ValidationFailed,
          details: [
            {
              field: 'toDate',
              message: expect.any(String),
            },
          ],
        });
      }
      expect(block).not.toHaveBeenCalled();
      expect(await nights.countDocuments()).toBe(0);
      expect(await rooms.findById(roomId).lean()).toMatchObject({
        inventoryVersion: 0,
      });
    });

    it('persists exactly 365 nights at the inclusive block limit across a leap day', async () => {
      const user = await moderator();
      const response = await t
        .http()
        .patch(`${path}/availability`)
        .set('Cookie', user.cookie)
        .send({
          op: 'BLOCK',
          fromDate: '2028-01-01',
          toDate: '2028-12-30',
        })
        .expect(200);
      expect(response.body).toEqual({
        blockId: expect.stringMatching(/^[a-f0-9]{24}$/),
      });
      const blocked = await nights
        .find({ roomId, blockId: response.body.blockId })
        .sort({ date: 1 })
        .lean();
      expect(blocked).toHaveLength(365);
      expect(blocked[0].date).toEqual(toDateOnly('2028-01-01'));
      expect(blocked[364].date).toEqual(toDateOnly('2028-12-30'));
      expect(await nights.countDocuments()).toBe(365);
    });

    it('returns a plain inactive room with calendar dates, and deletes a never-reserved room with its blocks', async () => {
      const user = await moderator();
      const response = await mutation('DEACTIVATE')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(response.body).toEqual({
        _id: roomId,
        hotelId,
        name: '101',
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10000,
        isActive: false,
        hasEverBeenReserved: false,
        availability: [
          {
            fromDate: toDateOnly(new Date().toISOString().slice(0, 10))
              .toISOString()
              .slice(0, 10),
            toDate: addDays(
              toDateOnly(new Date().toISOString().slice(0, 10)),
              30,
            )
              .toISOString()
              .slice(0, 10),
          },
        ],
      });
      await mutation('BLOCK').set('Cookie', user.cookie).expect(200);
      const deleted = await mutation('DELETE')
        .set('Cookie', user.cookie)
        .expect(204);
      expect(deleted.text).toBe('');
      expect(await rooms.findById(roomId)).toBeNull();
      expect(await nights.countDocuments()).toBe(0);
    });

    it.each(actions)(
      'enforces login, moderator role and hotel/room scope for %s',
      async (action) => {
        const unauthenticated = await mutation(action).expect(401);
        expect(unauthenticated.body.code).toBe(ErrorCode.NotAuthenticated);
        for (const role of [Role.USER, Role.ADMIN, Role.AIRLINE_MODERATOR]) {
          const user = await loginAs(t.connection, role);
          const forbidden = await mutation(action)
            .set('Cookie', user.cookie)
            .expect(403);
          expect(forbidden.body.code).toBe(ErrorCode.ForbiddenRole);
        }
        const otherHotelId = (
          await service.create({ ...profile, name: 'Other Hotel' })
        ).id;
        const user = await moderator();
        const other = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
          providerId: otherHotelId,
        });
        const wrongAssignment = await mutation(action)
          .set('Cookie', other.cookie)
          .expect(404);
        expect(wrongAssignment.body.code).toBe(ErrorCode.NotFound);
        for (const target of [
          `/api/hotels/${otherHotelId}/rooms/${roomId}`,
          `/api/hotels/${hotelId}/rooms/${new Types.ObjectId().toHexString()}`,
        ]) {
          const missing = await mutation(action, target)
            .set('Cookie', user.cookie)
            .expect(404);
          expect(missing.body.code).toBe(ErrorCode.NotFound);
        }
        const ownOtherHotel = await mutation(
          action,
          `/api/hotels/${otherHotelId}/rooms/${roomId}`,
        )
          .set('Cookie', other.cookie)
          .expect(404);
        expect(ownOtherHotel.body.code).toBe(ErrorCode.NotFound);
        const badId = await mutation(
          action,
          `/api/hotels/${hotelId}/rooms/invalid`,
        )
          .set('Cookie', user.cookie)
          .expect(400);
        expect(badId.body.code).toBe(ErrorCode.ValidationFailed);
        expect(await rooms.findById(roomId).lean()).toMatchObject({
          isActive: true,
          inventoryVersion: 0,
        });
        expect(await nights.countDocuments()).toBe(0);
      },
    );

    it('does not unblock another room or mistake a reservation ID for a block ID', async () => {
      const user = await moderator();
      const otherRoom = await rooms.create({
        hotelId,
        name: '102',
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10000,
      });
      const block = await service.manageRoomBlock(
        hotelId,
        otherRoom._id.toHexString(),
        blockBody,
        hotelId,
      );
      const reservationId = new Types.ObjectId().toHexString();
      await t.connection.transaction((session) =>
        inventory.reserve(
          hotelId,
          [roomId],
          fromDate,
          addDays(toDate, 1),
          reservationId,
          { session },
        ),
      );
      for (const blockId of [
        block.blockId,
        reservationId,
        new Types.ObjectId().toHexString(),
      ]) {
        const response = await t
          .http()
          .patch(`${path}/availability`)
          .set('Cookie', user.cookie)
          .send({ op: 'UNBLOCK', blockId })
          .expect(404);
        expect(response.body.code).toBe(ErrorCode.NotFound);
      }
      expect(await nights.countDocuments({ blockId: block.blockId })).toBe(3);
      expect(await nights.countDocuments({ reservationId })).toBe(3);
    });

    it('rejects invalid and mixed operation fields without writing any nights', async () => {
      const user = await moderator();
      for (const body of [
        {},
        { op: 'OTHER' },
        { op: 'BLOCK' },
        { ...blockBody, fromDate: null },
        { ...blockBody, fromDate: '2026-02-29' },
        { ...blockBody, toDate: '2026-12-01T00:00:00Z' },
        {
          ...blockBody,
          fromDate: blockBody.toDate,
          toDate: blockBody.fromDate,
        },
        { ...blockBody, blockId: new Types.ObjectId().toHexString() },
        { ...blockBody, reservationId: new Types.ObjectId().toHexString() },
        { op: 'UNBLOCK' },
        { op: 'UNBLOCK', blockId: null },
        { op: 'UNBLOCK', blockId: 'invalid' },
        {
          ...blockBody,
          op: 'UNBLOCK',
          blockId: new Types.ObjectId().toHexString(),
        },
        // One route for HTL-05 and HTL-06: an operation takes only its own fields.
        {
          op: 'SET_RANGES',
          ranges: [],
          blockId: new Types.ObjectId().toHexString(),
        },
        {
          op: 'UNBLOCK',
          blockId: new Types.ObjectId().toHexString(),
          ranges: [],
        },
      ]) {
        const response = await t
          .http()
          .patch(`${path}/availability`)
          .set('Cookie', user.cookie)
          .send(body)
          .expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
      for (const body of [
        {},
        { isActive: true },
        { isActive: null },
        { isActive: 'false' },
        { isActive: false, inventoryVersion: 9 },
        // Deactivation can't be combined with HTL-05 edits on the same route.
        { isActive: false, beds: 2 },
      ]) {
        const response = await t
          .http()
          .patch(path)
          .set('Cookie', user.cookie)
          .send(body)
          .expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
      expect(await nights.countDocuments()).toBe(0);
      expect(await rooms.findById(roomId).lean()).toMatchObject({
        inventoryVersion: 0,
        isActive: true,
      });
    });

    it('returns reservation conflicts without partial changes, and retains history after release', async () => {
      const user = await moderator();
      const reservationId = new Types.ObjectId().toHexString();
      await t.connection.transaction((session) =>
        inventory.reserve(
          hotelId,
          [roomId],
          fromDate,
          addDays(toDate, 1),
          reservationId,
          { session },
        ),
      );
      for (const [action, code] of [
        ['BLOCK', ErrorCode.OverlapsReservationOrBlock],
        ['DEACTIVATE', ErrorCode.RoomHasReservations],
        ['DELETE', ErrorCode.RoomHasReservations],
      ] as const) {
        const response = await mutation(action)
          .set('Cookie', user.cookie)
          .expect(409);
        expect(response.body.code).toBe(code);
      }
      expect(await nights.countDocuments()).toBe(3);
      expect(await rooms.findById(roomId).lean()).toMatchObject({
        isActive: true,
        inventoryVersion: 1,
      });
      await t.connection.transaction((session) =>
        inventory.release(reservationId, { session }),
      );
      const response = await mutation('DELETE')
        .set('Cookie', user.cookie)
        .expect(409);
      expect(response.body.code).toBe(ErrorCode.RoomWasReserved);
      await mutation('DEACTIVATE').set('Cookie', user.cookie).expect(200);
    });

    it('documents the HTL-06 operations, request/response types, authentication and conflicts in Swagger', () => {
      const document = SwaggerModule.createDocument(
        t.app,
        new DocumentBuilder().addCookieAuth('access_token').build(),
      );
      const availability =
        document.paths['/api/hotels/{id}/rooms/{roomId}/availability']?.patch;
      const room = document.paths['/api/hotels/{id}/rooms/{roomId}'];
      for (const endpoint of [availability, room?.patch, room?.delete]) {
        expect(endpoint).toMatchObject({
          summary: expect.stringContaining('HTL-06'),
          security: [{ cookie: [] }],
          responses: {
            '400': expect.any(Object),
            '401': expect.any(Object),
            '403': expect.any(Object),
            '404': expect.any(Object),
            '409': expect.any(Object),
          },
        });
      }
      expect(availability?.requestBody).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/RoomAvailabilityOperationDto',
            },
          },
        },
      });
      expect(room?.patch?.requestBody).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/PatchRoomDto' },
          },
        },
      });
      expect(room?.delete?.responses).toHaveProperty('204');
    });
  });

  describe('room endpoints (HTL-03)', () => {
    const input = {
      name: '101',
      type: 'Deluxe King',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightMinor: 10000,
    };

    it('creates a room at the minimum numeric boundaries with trimmed text and documented defaults', async () => {
      const hotel = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: hotel.id,
      });
      const response = await t
        .http()
        .post(`/api/hotels/${hotel.id}/rooms`)
        .set('Cookie', moderator.cookie)
        .send({
          ...input,
          name: ' 101 ',
          type: ' Deluxe King ',
          maxOccupancy: 1,
          pricePerNightMinor: 1,
        })
        .expect(201);
      expect(response.body).toEqual({
        ...input,
        _id: expect.stringMatching(/^[a-f0-9]{24}$/),
        hotelId: hotel.id,
        maxOccupancy: 1,
        pricePerNightMinor: 1,
        isActive: true,
        availability: [],
        hasEverBeenReserved: false,
      });
      const list = await t
        .http()
        .get(`/api/hotels/${hotel.id}/rooms`)
        .set('Cookie', moderator.cookie)
        .expect(200);
      expect(list.body).toEqual({
        items: [response.body],
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });

    it.each(['beds', 'maxOccupancy', 'pricePerNightMinor'] as const)(
      'rejects unsafe integers in %s without creating a room',
      async (field) => {
        const hotel = await service.create(profile);
        const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
          providerId: hotel.id,
        });
        for (const value of [Number.MAX_SAFE_INTEGER + 1, 1e21, 1e308]) {
          const response = await t
            .http()
            .post(`/api/hotels/${hotel.id}/rooms`)
            .set('Cookie', moderator.cookie)
            .send({ ...input, [field]: value })
            .expect(400);
          expect(response.body).toMatchObject({
            code: ErrorCode.ValidationFailed,
            details: expect.arrayContaining([
              expect.objectContaining({ field }),
            ]),
          });
        }
        expect(await rooms.countDocuments()).toBe(0);
      },
    );

    it('accepts and preserves the safe-integer boundary for all numeric room inputs', async () => {
      const hotel = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: hotel.id,
      });
      const fields = {
        beds: Number.MAX_SAFE_INTEGER,
        maxOccupancy: Number.MAX_SAFE_INTEGER,
        pricePerNightMinor: MAX_PRICE_MINOR,
      };
      const response = await t
        .http()
        .post(`/api/hotels/${hotel.id}/rooms`)
        .set('Cookie', moderator.cookie)
        .send({ ...input, ...fields })
        .expect(201);
      expect(response.body).toMatchObject(fields);
      expect(await service.getRooms(hotel.id)).toEqual([
        expect.objectContaining(fields),
      ]);
    });

    it('stores lowercase names, rejects case-only duplicates, and allows the same name in another hotel', async () => {
      const hotel = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: hotel.id,
      });
      const path = `/api/hotels/${hotel.id}/rooms`;
      const created = await t
        .http()
        .post(path)
        .set('Cookie', moderator.cookie)
        .send({ ...input, name: ' Room A ' })
        .expect(201);
      expect(created.body.name).toBe('room a');
      const duplicate = await t
        .http()
        .post(path)
        .set('Cookie', moderator.cookie)
        .send({ ...input, name: 'ROOM a' })
        .expect(409);
      expect(duplicate.body.code).toBe(ErrorCode.Conflict);
      const list = await t
        .http()
        .get(path)
        .set('Cookie', moderator.cookie)
        .expect(200);
      expect(list.body.items).toEqual([created.body]);
      const other = await service.create({ ...profile, name: 'Other Hotel' });
      const otherModerator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: other.id,
      });
      const otherRoom = await t
        .http()
        .post(`/api/hotels/${other.id}/rooms`)
        .set('Cookie', otherModerator.cookie)
        .send({ ...input, name: 'ROOM A' })
        .expect(201);
      expect(otherRoom.body).toMatchObject({
        hotelId: other.id,
        name: 'room a',
      });
    });

    it('returns 409 CONFLICT for a duplicate trimmed name without changing the existing room', async () => {
      const hotel = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: hotel.id,
      });
      await t
        .http()
        .post(`/api/hotels/${hotel.id}/rooms`)
        .set('Cookie', moderator.cookie)
        .send(input)
        .expect(201);
      const duplicate = await t
        .http()
        .post(`/api/hotels/${hotel.id}/rooms`)
        .set('Cookie', moderator.cookie)
        .send({ ...input, name: ' 101 ', beds: 3 })
        .expect(409);
      expect(duplicate.body.code).toBe(ErrorCode.Conflict);
      expect(await rooms.countDocuments()).toBe(1);
      expect((await service.getRooms(hotel.id))[0]?.beds).toBe(1);
    });

    it('paginates within the hotel and serializes inactive room dates as calendar dates', async () => {
      const hotel = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: hotel.id,
      });
      await service.createRoom(hotel.id, input, hotel.id);
      const second = await rooms.create({
        ...input,
        hotelId: hotel.id,
        name: '102',
        isActive: false,
        availability: [
          {
            fromDate: toDateOnly('2026-12-01'),
            toDate: toDateOnly('2026-12-31'),
          },
        ],
      });
      const other = await service.create({ ...profile, name: 'Other Hotel' });
      await service.createRoom(other.id, input, other.id);
      const response = await t
        .http()
        .get(`/api/hotels/${hotel.id}/rooms?page=2&limit=1`)
        .set('Cookie', moderator.cookie)
        .expect(200);
      expect(response.body).toEqual({
        items: [
          {
            ...input,
            name: '102',
            _id: second._id.toHexString(),
            hotelId: hotel.id,
            isActive: false,
            hasEverBeenReserved: false,
            availability: [{ fromDate: '2026-12-01', toDate: '2026-12-31' }],
          },
        ],
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
    });

    it('requires authentication and the hotel-moderator role for creating and listing rooms', async () => {
      const hotel = await service.create(profile);
      const path = `/api/hotels/${hotel.id}/rooms`;
      for (const response of [
        await t.http().post(path).send(input).expect(401),
        await t.http().get(path).expect(401),
      ]) {
        expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
      }
      for (const role of [Role.ADMIN, Role.USER, Role.AIRLINE_MODERATOR]) {
        const user = await loginAs(t.connection, role);
        for (const response of [
          await t
            .http()
            .post(path)
            .set('Cookie', user.cookie)
            .send(input)
            .expect(403),
          await t.http().get(path).set('Cookie', user.cookie).expect(403),
        ]) {
          expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
        }
      }
      expect(await rooms.countDocuments()).toBe(0);
    });

    it('returns 404 for another moderator hotel and a missing assigned hotel without writing', async () => {
      const hotel = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR);
      for (const id of [hotel.id, moderator.providerId]) {
        const path = `/api/hotels/${id}/rooms`;
        for (const response of [
          await t
            .http()
            .post(path)
            .set('Cookie', moderator.cookie)
            .send(input)
            .expect(404),
          await t.http().get(path).set('Cookie', moderator.cookie).expect(404),
        ]) {
          expect(response.body.code).toBe(ErrorCode.NotFound);
        }
      }
      expect(await rooms.countDocuments()).toBe(0);
    });

    it('validates required fields, numeric bounds, integer inputs and free-text type length', async () => {
      const hotel = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: hotel.id,
      });
      for (const [field, value] of [
        ['name', undefined],
        ['name', '   '],
        ['name', 101],
        ['type', null],
        ['type', ' '],
        ['type', 'x'.repeat(51)],
        ['beds', 0],
        ['beds', 1.5],
        ['beds', '2'],
        ['maxOccupancy', 0],
        ['maxOccupancy', 1.5],
        ['pricePerNightMinor', 0],
        ['pricePerNightMinor', 1.5],
        ['pricePerNightMinor', '10000'],
      ] as const) {
        const response = await t
          .http()
          .post(`/api/hotels/${hotel.id}/rooms`)
          .set('Cookie', moderator.cookie)
          .send({ ...input, [field]: value })
          .expect(400);
        expect(response.body).toMatchObject({
          code: ErrorCode.ValidationFailed,
          details: expect.arrayContaining([expect.objectContaining({ field })]),
        });
      }
      expect(await rooms.countDocuments()).toBe(0);
    });

    it('rejects protected fields, malformed hotel IDs and invalid pagination', async () => {
      const hotel = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: hotel.id,
      });
      for (const extra of [
        { hotelId: hotel.id },
        { providerId: hotel.id },
        { isActive: false },
        { availability: [] },
        { hasEverBeenReserved: true },
        { inventoryVersion: 5 },
      ]) {
        const response = await t
          .http()
          .post(`/api/hotels/${hotel.id}/rooms`)
          .set('Cookie', moderator.cookie)
          .send({ ...input, ...extra })
          .expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
      for (const response of [
        await t
          .http()
          .post('/api/hotels/invalid/rooms')
          .set('Cookie', moderator.cookie)
          .send(input)
          .expect(400),
        await t
          .http()
          .get('/api/hotels/invalid/rooms')
          .set('Cookie', moderator.cookie)
          .expect(400),
      ]) {
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
      for (const query of [
        'page=0',
        'page=1.5',
        'limit=0',
        'limit=51',
        'limit=invalid',
      ]) {
        const response = await t
          .http()
          .get(`/api/hotels/${hotel.id}/rooms?${query}`)
          .set('Cookie', moderator.cookie)
          .expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
      expect(await rooms.countDocuments()).toBe(0);
    });

    it('documents the room request, paginated response, authentication and errors in Swagger', () => {
      const document = SwaggerModule.createDocument(
        t.app,
        new DocumentBuilder()
          .setTitle('Travel Platform API')
          .setVersion('0.0.1')
          .addCookieAuth('access_token')
          .build(),
      );
      const path = document.paths['/api/hotels/{id}/rooms'];
      for (const operation of [path?.post, path?.get]) {
        expect(operation?.summary).toContain('HTL-03');
        expect(operation?.security).toEqual([{ cookie: [] }]);
        for (const status of ['400', '401', '403', '404']) {
          expect(operation?.responses[status]).toBeDefined();
        }
      }
      expect(path?.post?.requestBody).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateRoomDto' },
          },
        },
      });
      expect(path?.post?.responses['201']).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RoomResponseDto' },
          },
        },
      });
      expect(path?.post?.responses['409']).toBeDefined();
      expect(path?.get?.responses['200']).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/PaginatedRoomsResponseDto' },
          },
        },
      });
      expect(path?.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'page', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
        ]),
      );
    });
  });

  describe('hotel policy endpoint (HTL-09, HTL-10)', () => {
    const policies = {
      checkInTime: '15:30',
      checkOutTime: '11:00',
      cancellationPolicy: {
        tiers: [
          { daysBefore: 7, refundPercent: 100 },
          { daysBefore: 2, refundPercent: 50 },
          { daysBefore: 0, refundPercent: 0 },
        ],
      },
    };

    it('lets the assigned moderator replace policies and clear all cancellation tiers', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      const { id, ...fields } = created;
      const path = `/api/hotels/${id}/policies`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await t
          .http()
          .put(path)
          .set('Cookie', moderator.cookie)
          .send(policies)
          .expect(200);
        expect(response.body).toEqual({ _id: id, ...fields, ...policies });
      }
      expect(await service.getHotel(id)).toEqual({ ...created, ...policies });
      const cleared = {
        ...policies,
        checkInTime: '23:59',
        checkOutTime: '00:00',
        cancellationPolicy: { tiers: [] },
      };
      const response = await t
        .http()
        .put(path)
        .set('Cookie', moderator.cookie)
        .send(cleared)
        .expect(200);
      expect(response.body).toEqual({ _id: id, ...fields, ...cleared });
      expect(await service.getHotel(id)).toEqual({ ...created, ...cleared });
    });

    it('requires authentication and the hotel-moderator role without changing policies', async () => {
      const created = await service.create(profile);
      const path = `/api/hotels/${created.id}/policies`;
      const guest = await t.http().put(path).send(policies).expect(401);
      expect(guest.body.code).toBe(ErrorCode.NotAuthenticated);
      for (const role of [Role.ADMIN, Role.USER, Role.AIRLINE_MODERATOR]) {
        const account = await loginAs(t.connection, role);
        const response = await t
          .http()
          .put(path)
          .set('Cookie', account.cookie)
          .send(policies)
          .expect(403);
        expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
      }
      expect(await service.getHotel(created.id)).toEqual(created);
    });

    it('returns the same 404 for another hotel and a missing assigned hotel', async () => {
      const created = await service.create(profile);
      const assigned = await service.create({
        ...profile,
        name: 'Other Hotel',
      });
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: assigned.id,
      });
      const other = await t
        .http()
        .put(`/api/hotels/${created.id}/policies`)
        .set('Cookie', moderator.cookie)
        .send(policies)
        .expect(404);
      const missingId = new Types.ObjectId().toHexString();
      const missingModerator = await loginAs(
        t.connection,
        Role.HOTEL_MODERATOR,
        { providerId: missingId },
      );
      const missing = await t
        .http()
        .put(`/api/hotels/${missingId}/policies`)
        .set('Cookie', missingModerator.cookie)
        .send(policies)
        .expect(404);
      expect(other.body.code).toBe(ErrorCode.NotFound);
      expect(missing.body.code).toBe(ErrorCode.NotFound);
      expect(other.body.message).toBe(missing.body.message);
      expect(await service.getHotel(created.id)).toEqual(created);
      expect(await service.getHotel(assigned.id)).toEqual(assigned);
    });

    it('rejects invalid and incomplete policies with field errors and no partial writes', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      for (const input of [
        { ...policies, checkInTime: '24:00' },
        { ...policies, checkOutTime: '12:60' },
        { checkInTime: policies.checkInTime },
        {
          ...policies,
          cancellationPolicy: {
            tiers: [
              { daysBefore: 7, refundPercent: 100 },
              { daysBefore: 7, refundPercent: 50 },
            ],
          },
        },
        {
          ...policies,
          cancellationPolicy: {
            tiers: [{ daysBefore: 1.5, refundPercent: 101 }],
          },
        },
        { ...policies, providerId: created.id },
        {
          ...policies,
          cancellationPolicy: { tiers: [], isActive: false },
        },
      ]) {
        const response = await t
          .http()
          .put(`/api/hotels/${created.id}/policies`)
          .set('Cookie', moderator.cookie)
          .send(input)
          .expect(400);
        expect(response.body).toMatchObject({
          code: ErrorCode.ValidationFailed,
          details: expect.arrayContaining([
            expect.objectContaining({ field: expect.any(String) }),
          ]),
        });
        expect(await service.getHotel(created.id)).toEqual(created);
      }
      const malformed = await t
        .http()
        .put('/api/hotels/invalid/policies')
        .set('Cookie', moderator.cookie)
        .send(policies)
        .expect(400);
      expect(malformed.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('hotel photo endpoints', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    it('uploads JPG and PNG images with computed URLs and deletes a selected photo', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      for (const [filename, contentType] of [
        ['hotel.jpg', 'image/jpeg'],
        ['hotel.png', 'image/png'],
      ]) {
        const response = await t
          .http()
          .post(`/api/hotels/${created.id}/photos`)
          .set('Cookie', moderator.cookie)
          .attach(
            'file',
            imageBytes(contentType === 'image/png' ? 'png' : 'jpg'),
            {
              filename,
              contentType,
            },
          )
          .expect(201);
        for (const photo of response.body.photos) {
          expect(photo).toEqual({
            _id: expect.any(String),
            key: expect.any(String),
            url: `/uploads/${photo.key}`,
          });
          expect(storage.has(photo.key)).toBe(true);
        }
      }
      const photos = (await service.getHotel(created.id))!.photos;
      expect(photos).toHaveLength(2);
      const response = await t
        .http()
        .delete(`/api/hotels/${created.id}/photos/${photos[0]!.id}`)
        .set('Cookie', moderator.cookie)
        .expect(204);
      expect(response.text).toBe('');
      expect(storage.has(photos[0]!.key)).toBe(false);
      expect((await service.getHotel(created.id))!.photos).toEqual([photos[1]]);
    });

    it('accepts an image of exactly 5 MB', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      const image = Buffer.alloc(MAX_IMAGE_BYTES);
      bytes.copy(image);
      await t
        .http()
        .post(`/api/hotels/${created.id}/photos`)
        .set('Cookie', moderator.cookie)
        .attach('file', image, {
          filename: 'boundary.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
      expect(storage.bytesOf(storage.keys()[0]!)?.length).toBe(MAX_IMAGE_BYTES);
    });

    it('rejects missing, empty, unsupported and oversized files without saving them', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      const path = `/api/hotels/${created.id}/photos`;
      const missing = await t
        .http()
        .post(path)
        .set('Cookie', moderator.cookie)
        .expect(400);
      expect(missing.body.code).toBe(ErrorCode.ValidationFailed);
      for (const [buffer, filename, contentType] of [
        [Buffer.alloc(0), 'empty.jpg', 'image/jpeg'],
        [bytes, 'document.pdf', 'application/pdf'],
      ] as const) {
        const response = await t
          .http()
          .post(path)
          .set('Cookie', moderator.cookie)
          .attach('file', buffer, { filename, contentType })
          .expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
      const oversized = await t
        .http()
        .post(path)
        .set('Cookie', moderator.cookie)
        .attach('file', Buffer.alloc(MAX_IMAGE_BYTES + 1), {
          filename: 'large.jpg',
          contentType: 'image/jpeg',
        })
        .expect(413);
      expect(oversized.body.code).toBe(ErrorCode.RequestFailed);
      const multiple = await t
        .http()
        .post(path)
        .set('Cookie', moderator.cookie)
        .attach('file', bytes, 'one.jpg')
        .attach('file', bytes, 'two.jpg')
        .expect(400);
      expect(multiple.body.code).toBe(ErrorCode.ValidationFailed);
      expect(storage.keys()).toEqual([]);
      expect((await service.getHotel(created.id))!.photos).toEqual([]);
    });

    it('rejects the sixth photo and retains exactly the five attached files', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      for (let i = 0; i < 5; i++) {
        await t
          .http()
          .post(`/api/hotels/${created.id}/photos`)
          .set('Cookie', moderator.cookie)
          .attach('file', bytes, 'hotel.jpg')
          .expect(201);
      }
      const response = await t
        .http()
        .post(`/api/hotels/${created.id}/photos`)
        .set('Cookie', moderator.cookie)
        .attach('file', bytes, 'extra.jpg')
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.LimitExceeded);
      expect((await service.getHotel(created.id))!.photos).toHaveLength(5);
      expect(storage.keys()).toHaveLength(5);
    });

    it('requires authentication and the hotel-moderator role for both operations', async () => {
      const created = await service.create(profile);
      const path = `/api/hotels/${created.id}/photos`;
      const photoId = new Types.ObjectId().toHexString();
      const guestUpload = await t.http().post(path).expect(401);
      const guestDelete = await t
        .http()
        .delete(`${path}/${photoId}`)
        .expect(401);
      for (const response of [guestUpload, guestDelete])
        expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
      for (const role of [Role.ADMIN, Role.USER, Role.AIRLINE_MODERATOR]) {
        const user = await loginAs(t.connection, role);
        const upload = await t
          .http()
          .post(path)
          .set('Cookie', user.cookie)
          .expect(403);
        const remove = await t
          .http()
          .delete(`${path}/${photoId}`)
          .set('Cookie', user.cookie)
          .expect(403);
        for (const response of [upload, remove])
          expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
      }
      expect(storage.keys()).toEqual([]);
    });

    it('does not expose or mutate another moderator hotel, even with a spoofed body assignment', async () => {
      const created = await service.create(profile);
      const photo = (
        await service.addPhoto(
          created.id,
          {
            buffer: bytes,
            originalname: 'hotel.jpg',
            mimetype: 'image/jpeg',
            size: bytes.length,
          },
          created.id,
        )
      ).photos[0]!;
      const other = await loginAs(t.connection, Role.HOTEL_MODERATOR);
      const upload = await t
        .http()
        .post(`/api/hotels/${created.id}/photos`)
        .set('Cookie', other.cookie)
        .field('providerId', created.id)
        .attach('file', bytes, 'denied.jpg')
        .expect(404);
      const remove = await t
        .http()
        .delete(`/api/hotels/${created.id}/photos/${photo.id}`)
        .set('Cookie', other.cookie)
        .expect(404);
      expect(upload.body.code).toBe(ErrorCode.NotFound);
      expect(remove.body.code).toBe(ErrorCode.NotFound);
      expect((await service.getHotel(created.id))!.photos).toEqual([photo]);
      expect(storage.keys()).toEqual([photo.key]);
    });

    it('rejects missing photos and malformed IDs without deleting a file', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      const missing = await t
        .http()
        .delete(
          `/api/hotels/${created.id}/photos/${new Types.ObjectId().toHexString()}`,
        )
        .set('Cookie', moderator.cookie)
        .expect(404);
      expect(missing.body.code).toBe(ErrorCode.NotFound);
      const malformedPhoto = await t
        .http()
        .delete(`/api/hotels/${created.id}/photos/invalid`)
        .set('Cookie', moderator.cookie)
        .expect(400);
      const malformedHotel = await t
        .http()
        .post('/api/hotels/invalid/photos')
        .set('Cookie', moderator.cookie)
        .attach('file', bytes, 'hotel.jpg')
        .expect(400);
      for (const response of [malformedPhoto, malformedHotel])
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      expect(storage.keys()).toEqual([]);
    });
  });

  it('allows an admin to create a hotel and returns only the documented profile fields', async () => {
    const admin = await loginAs(t.connection, Role.ADMIN);
    const response = await t
      .http()
      .post('/api/hotels')
      .set('Cookie', admin.cookie)
      .send({ ...profile, name: '  Nile View Hotel  ' })
      .expect(201);
    expect(response.body).toEqual({
      ...profile,
      _id: expect.stringMatching(/^[0-9a-f]{24}$/),
      countryCode: 'EG',
      photos: [],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationPolicy: { tiers: [] },
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    });
    const { _id, ...fields } = response.body;
    expect(await service.getHotel(_id)).toEqual({ id: _id, ...fields });
    expect(await hotels.countDocuments()).toBe(1);
  });

  it('uses the authenticated moderator assignment for a partial edit', async () => {
    const created = await service.create(profile);
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    const response = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', moderator.cookie)
      .send({ name: '  Dubai View  ', cityId: 'dubai' })
      .expect(200);
    const { id, ...fields } = created;
    expect(response.body).toEqual({
      ...fields,
      _id: id,
      name: 'Dubai View',
      cityId: 'dubai',
      countryCode: 'AE',
    });
    expect(await service.getHotel(created.id)).toEqual({
      ...created,
      name: 'Dubai View',
      cityId: 'dubai',
      countryCode: 'AE',
    });
  });

  it('allows the assigned moderator to edit a deactivated hotel without reactivating it', async () => {
    const created = await service.create(profile);
    await service.setActive(created.id, false);
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    const response = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', moderator.cookie)
      .send({ name: 'Edited while hidden' })
      .expect(200);
    expect(response.body).toMatchObject({
      _id: created.id,
      name: 'Edited while hidden',
      isActive: false,
    });
    expect(await service.getHotel(created.id)).toEqual({
      ...created,
      name: 'Edited while hidden',
      isActive: false,
    });
  });

  it('computes photo URLs in HTTP responses without changing the stored or internal view', async () => {
    const created = await service.create(profile);
    const photoId = new Types.ObjectId();
    await hotels.updateOne(
      { _id: created.id },
      { $set: { photos: [{ _id: photoId, key: 'hotel.jpg' }] } },
    );
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    const response = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', moderator.cookie)
      .send({ description: '' })
      .expect(200);
    expect(response.body.photos).toEqual([
      {
        _id: photoId.toHexString(),
        key: 'hotel.jpg',
        url: '/uploads/hotel.jpg',
      },
    ]);
    expect((await service.getHotel(created.id))?.photos).toEqual([
      { id: photoId.toHexString(), key: 'hotel.jpg' },
    ]);
    expect(
      (await hotels.findById(created.id).lean().exec())?.photos[0],
    ).not.toHaveProperty('url');
  });

  it('rejects guests before either profile mutation', async () => {
    const id = new Types.ObjectId().toHexString();
    for (const request of [
      t.http().post('/api/hotels').send(profile),
      t.http().patch(`/api/hotels/${id}`).send({ name: 'Denied' }),
    ]) {
      const response = await request.expect(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        code: ErrorCode.NotAuthenticated,
      });
    }
    expect(await hotels.countDocuments()).toBe(0);
  });

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'rejects hotel creation by %s with 403',
    async (role) => {
      const user = await loginAs(t.connection, role);
      const response = await t
        .http()
        .post('/api/hotels')
        .set('Cookie', user.cookie)
        .send(profile)
        .expect(403);
      expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
      expect(await hotels.countDocuments()).toBe(0);
    },
  );

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.ADMIN])(
    'rejects hotel editing by %s with 403',
    async (role) => {
      const created = await service.create(profile);
      const user = await loginAs(t.connection, role);
      const response = await t
        .http()
        .patch(`/api/hotels/${created.id}`)
        .set('Cookie', user.cookie)
        .send({ name: 'Denied' })
        .expect(403);
      expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
      expect(await service.getHotel(created.id)).toEqual(created);
    },
  );

  it('returns the same 404 for another hotel and a missing assigned hotel without changing either profile', async () => {
    const created = await service.create(profile);
    const assigned = await service.create({
      ...profile,
      name: 'Assigned Hotel',
    });
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: assigned.id,
    });
    const other = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', moderator.cookie)
      .send({ name: 'Denied' })
      .expect(404);
    const missingId = new Types.ObjectId().toHexString();
    const missingModerator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: missingId,
    });
    const missing = await t
      .http()
      .patch(`/api/hotels/${missingId}`)
      .set('Cookie', missingModerator.cookie)
      .send({ name: 'Missing' })
      .expect(404);
    for (const response of [other, missing]) {
      expect(response.body.code).toBe(ErrorCode.NotFound);
    }
    expect(other.body.message).toBe(missing.body.message);
    expect(await service.getHotel(created.id)).toEqual(created);
    expect(await service.getHotel(assigned.id)).toEqual(assigned);
  });

  it('rejects invalid input and unknown cities through the production validation pipeline', async () => {
    const admin = await loginAs(t.connection, Role.ADMIN);
    for (const input of [
      { ...profile, name: ' ' },
      { ...profile, cityId: 'missing' },
    ]) {
      const response = await t
        .http()
        .post('/api/hotels')
        .set('Cookie', admin.cookie)
        .send(input)
        .expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        code: ErrorCode.ValidationFailed,
        details: expect.arrayContaining([
          expect.objectContaining({
            field: input.name === ' ' ? 'name' : 'cityId',
          }),
        ]),
      });
    }
    expect(await hotels.countDocuments()).toBe(0);
    const created = await service.create(profile);
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    for (const input of [
      { amenities: null },
      { cityId: 'missing', name: 'Must not persist' },
    ]) {
      const response = await t
        .http()
        .patch(`/api/hotels/${created.id}`)
        .set('Cookie', moderator.cookie)
        .send(input)
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    }
    const invalidId = await t
      .http()
      .patch('/api/hotels/not-an-id')
      .set('Cookie', moderator.cookie)
      .send({ name: 'Denied' })
      .expect(400);
    expect(invalidId.body.code).toBe(ErrorCode.ValidationFailed);
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('rejects attempts to supply moderator identity or protected hotel fields', async () => {
    const created = await service.create(profile);
    const admin = await loginAs(t.connection, Role.ADMIN);
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    for (const protectedInput of [
      { providerId: created.id },
      { moderatorHotelId: created.id },
      { countryCode: 'US' },
      { isActive: false },
      { photos: [] },
      { ratingSummary: { average: 5, count: 1 } },
      { checkInTime: '01:00' },
      { cancellationPolicy: { tiers: [] } },
    ]) {
      const createdResponse = await t
        .http()
        .post('/api/hotels')
        .set('Cookie', admin.cookie)
        .send({ ...profile, ...protectedInput })
        .expect(400);
      const updatedResponse = await t
        .http()
        .patch(`/api/hotels/${created.id}`)
        .set('Cookie', moderator.cookie)
        .send(protectedInput)
        .expect(400);
      for (const response of [createdResponse, updatedResponse]) {
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
    }
    expect(await hotels.countDocuments()).toBe(1);
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('enforces session expiry and the first-login password change before editing', async () => {
    const created = await service.create(profile);
    const expired = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
      sessionExpired: true,
    });
    const temporaryPassword = await loginAs(
      t.connection,
      Role.HOTEL_MODERATOR,
      { providerId: created.id, mustChangePassword: true },
    );
    const expiredResponse = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', expired.cookie)
      .send({ name: 'Denied' })
      .expect(401);
    expect(expiredResponse.body.code).toBe(ErrorCode.SessionExpired);
    const gatedResponse = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', temporaryPassword.cookie)
      .send({ name: 'Denied' })
      .expect(403);
    expect(gatedResponse.body.code).toBe(ErrorCode.PasswordChangeRequired);
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('documents the protected profile endpoints, inputs, responses, and errors in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder()
        .setTitle('Travel Platform API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );
    const create = document.paths['/api/hotels']?.post;
    const update = document.paths['/api/hotels/{id}']?.patch;
    const upload = document.paths['/api/hotels/{id}/photos']?.post;
    const remove = document.paths['/api/hotels/{id}/photos/{photoId}']?.delete;
    for (const operation of [create, update, upload, remove]) {
      expect(operation?.security).toEqual([{ cookie: [] }]);
      expect(operation?.summary).toContain('HTL-01');
      expect(operation?.responses['400']).toBeDefined();
      expect(operation?.responses['401']).toBeDefined();
      expect(operation?.responses['403']).toBeDefined();
    }
    expect(create?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateHotelDto' },
        },
      },
    });
    expect(create?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/HotelProfileResponseDto' },
        },
      },
    });
    expect(update?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateHotelDto' },
        },
      },
    });
    expect(update?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/HotelProfileResponseDto' },
        },
      },
    });
    expect(update?.responses['404']).toBeDefined();
    expect(upload?.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: {
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary' } },
          },
        },
      },
    });
    expect(upload?.responses['201']).toBeDefined();
    expect(upload?.responses['400']).toBeDefined();
    expect(upload?.responses['409']).toBeUndefined();
    expect(remove?.responses['204']).toBeDefined();
    expect(remove?.responses['404']).toBeDefined();
    const policies = document.paths['/api/hotels/{id}/policies']?.put;
    expect(policies?.security).toEqual([{ cookie: [] }]);
    expect(policies?.summary).toContain('HTL-09');
    expect(policies?.summary).toContain('HTL-10');
    expect(policies?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateHotelPoliciesDto' },
        },
      },
    });
    expect(policies?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/HotelProfileResponseDto' },
        },
      },
    });
    for (const status of ['400', '401', '403', '404']) {
      expect(policies?.responses[status]).toBeDefined();
    }
    expect(document.components?.schemas?.UpdateHotelPoliciesDto).toMatchObject({
      required: ['checkInTime', 'checkOutTime', 'cancellationPolicy'],
    });
    expect(document.paths['/api/hotels/{id}']?.get).toMatchObject({
      security: [],
      summary: expect.stringContaining('HTL-02'),
    });
  });
});
