import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FakeFlightBookingsService } from '../../../test/fakes/flight-bookings.fake.js';
import { FakeHotelBookingsService } from '../../../test/fakes/hotel-bookings.fake.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { loginAs } from '../../../test/support/auth.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service.js';
import type { FlightBookingAdminView } from '../flight-bookings/flight-bookings.types.js';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service.js';
import type { HotelReservationAdminView } from '../hotel-bookings/hotel-bookings.types.js';
import { AdminModule } from './admin.module.js';

const ALLOWED_KEYS_WITH_REFERENCE = [
  'bookingId',
  'bookingType',
  'createdAt',
  'currency',
  'endAt',
  'providerId',
  'reference',
  'startAt',
  'status',
  'totalMinor',
  'userId',
];

const ALLOWED_KEYS_WITHOUT_REFERENCE = [
  'bookingId',
  'bookingType',
  'createdAt',
  'currency',
  'endAt',
  'providerId',
  'startAt',
  'status',
  'totalMinor',
  'userId',
];

function makeId(hexChar: string): string {
  return hexChar.repeat(24).slice(0, 24);
}

const FLIGHT_SEED: FlightBookingAdminView[] = [
  {
    bookingType: BookingType.FLIGHT,
    bookingId: '6736f0b2c5a1b2c3d4e50001',
    reference: 'FB-OUT-AFTER',
    userId: makeId('a'),
    providerId: makeId('1'),
    startAt: new Date('2026-12-20T08:00:00.000Z'),
    endAt: new Date('2026-12-20T12:00:00.000Z'),
    totalMinor: 31000,
    currency: 'USD',
    status: 'confirmed',
    createdAt: new Date('2026-11-16T00:00:00.000Z'), // 1 day after range end (Nov 15)
  },
  {
    bookingType: BookingType.FLIGHT,
    bookingId: '6736f0b2c5a1b2c3d4e50002',
    reference: 'FB-END-DAY',
    userId: makeId('b'),
    providerId: makeId('1'),
    startAt: new Date('2026-12-18T09:00:00.000Z'),
    endAt: new Date('2026-12-18T12:30:00.000Z'),
    totalMinor: 27500,
    currency: 'USD',
    status: 'confirmed',
    createdAt: new Date('2026-11-15T23:59:59.999Z'), // exact end of Nov 15 UTC
  },
  {
    bookingType: BookingType.FLIGHT,
    bookingId: '6736f0b2c5a1b2c3d4e50003',
    reference: 'FB-TIE',
    userId: makeId('c'),
    providerId: makeId('2'),
    startAt: new Date('2026-12-15T10:00:00.000Z'),
    endAt: new Date('2026-12-15T13:00:00.000Z'),
    totalMinor: 19500,
    currency: 'EUR',
    status: 'completed',
    createdAt: new Date('2026-11-13T12:00:00.000Z'), // shares timestamp with HB-TIE
  },
  {
    bookingType: BookingType.FLIGHT,
    bookingId: '6736f0b2c5a1b2c3d4e50004',
    userId: makeId('d'),
    providerId: makeId('2'),
    startAt: new Date('2026-12-12T10:00:00.000Z'),
    endAt: new Date('2026-12-12T13:00:00.000Z'),
    totalMinor: 18000,
    currency: 'USD',
    status: 'pending_payment',
    createdAt: new Date('2026-11-12T08:00:00.000Z'),
  },
  {
    bookingType: BookingType.FLIGHT,
    bookingId: '6736f0b2c5a1b2c3d4e50005',
    reference: 'FB-START-DAY',
    userId: makeId('e'),
    providerId: makeId('3'),
    startAt: new Date('2026-12-10T06:00:00.000Z'),
    endAt: new Date('2026-12-10T09:00:00.000Z'),
    totalMinor: 22000,
    currency: 'USD',
    status: 'confirmed',
    createdAt: new Date('2026-11-10T00:00:00.000Z'), // exact start of Nov 10 UTC
  },
  {
    bookingType: BookingType.FLIGHT,
    bookingId: '6736f0b2c5a1b2c3d4e50006',
    reference: 'FB-OUT-BEFORE',
    userId: makeId('f'),
    providerId: makeId('3'),
    startAt: new Date('2026-12-08T06:00:00.000Z'),
    endAt: new Date('2026-12-08T09:00:00.000Z'),
    totalMinor: 15000,
    currency: 'USD',
    status: 'cancelled',
    createdAt: new Date('2026-11-09T23:59:59.999Z'), // 1 day before Nov 10
  },
];

const HOTEL_SEED: HotelReservationAdminView[] = [
  {
    bookingType: BookingType.HOTEL,
    bookingId: '6736f0b2c5a1b2c3d4e60001',
    reference: 'HB-OUT-AFTER',
    userId: makeId('a'),
    providerId: makeId('4'),
    startAt: new Date('2026-12-22T15:00:00.000Z'),
    endAt: new Date('2026-12-25T11:00:00.000Z'),
    totalMinor: 54000,
    currency: 'USD',
    status: 'confirmed',
    createdAt: new Date('2026-11-17T09:00:00.000Z'), // 2 days after Nov 15
  },
  {
    bookingType: BookingType.HOTEL,
    bookingId: '6736f0b2c5a1b2c3d4e60002',
    reference: 'HB-MID-CONFIRMED',
    userId: makeId('b'),
    providerId: makeId('4'),
    startAt: new Date('2026-12-16T15:00:00.000Z'),
    endAt: new Date('2026-12-19T11:00:00.000Z'),
    totalMinor: 42000,
    currency: 'USD',
    status: 'confirmed',
    createdAt: new Date('2026-11-14T15:30:00.000Z'),
  },
  {
    bookingType: BookingType.HOTEL,
    bookingId: '6736f0b2c5a1b2c3d4e60003',
    reference: 'HB-TIE',
    userId: makeId('c'),
    providerId: makeId('5'),
    startAt: new Date('2026-12-14T15:00:00.000Z'),
    endAt: new Date('2026-12-16T11:00:00.000Z'),
    totalMinor: 39000,
    currency: 'USD',
    status: 'completed',
    createdAt: new Date('2026-11-13T12:00:00.000Z'), // shares timestamp with FB-TIE
  },
  {
    bookingType: BookingType.HOTEL,
    bookingId: '6736f0b2c5a1b2c3d4e60004',
    userId: makeId('d'),
    providerId: makeId('5'),
    startAt: new Date('2026-12-11T15:00:00.000Z'),
    endAt: new Date('2026-12-13T11:00:00.000Z'),
    totalMinor: 29000,
    currency: 'USD',
    status: 'expired',
    createdAt: new Date('2026-11-11T10:00:00.000Z'),
  },
  {
    bookingType: BookingType.HOTEL,
    bookingId: '6736f0b2c5a1b2c3d4e60005',
    reference: 'HB-MID-CANCELLED',
    userId: makeId('e'),
    providerId: makeId('6'),
    startAt: new Date('2026-12-09T15:00:00.000Z'),
    endAt: new Date('2026-12-10T11:00:00.000Z'),
    totalMinor: 21000,
    currency: 'USD',
    status: 'cancelled',
    createdAt: new Date('2026-11-10T18:00:00.000Z'),
  },
  {
    bookingType: BookingType.HOTEL,
    bookingId: '6736f0b2c5a1b2c3d4e60006',
    reference: 'HB-OUT-BEFORE',
    userId: makeId('f'),
    providerId: makeId('6'),
    startAt: new Date('2026-12-05T15:00:00.000Z'),
    endAt: new Date('2026-12-07T11:00:00.000Z'),
    totalMinor: 16000,
    currency: 'USD',
    status: 'confirmed',
    createdAt: new Date('2026-11-08T12:00:00.000Z'), // 2 days before Nov 10
  },
];

describe('Admin Bookings API (ACC-17)', () => {
  let testApp: TestApp | undefined;

  beforeAll(async () => {
    const fakeFlights = new FakeFlightBookingsService(FLIGHT_SEED);
    const fakeHotels = new FakeHotelBookingsService(HOTEL_SEED);

    testApp = await createTestApp({
      imports: [AdminModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightBookingsService)
          .useValue(fakeFlights)
          .overrideProvider(HotelBookingsService)
          .useValue(fakeHotels),
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await testApp?.close();
  }, HOOK_TIMEOUT);

  it('registers Swagger metadata for GET /api/admin/bookings with no write operations', () => {
    const document = SwaggerModule.createDocument(
      testApp!.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );

    const pathItem = document.paths['/api/admin/bookings'];
    expect(pathItem?.get).toBeDefined();
    expect(pathItem?.get?.tags).toContain('admin');
    expect(pathItem?.get?.summary).toContain('ACC-17');
    expect(pathItem?.get?.security).toBeDefined();
    expect(pathItem?.post).toBeUndefined();
    expect(pathItem?.patch).toBeUndefined();
    expect(pathItem?.put).toBeUndefined();
    expect(pathItem?.delete).toBeUndefined();
  });

  describe('Auth & RBAC', () => {
    it('rejects unauthenticated requests with 401 NOT_AUTHENTICATED', async () => {
      const res = await testApp!.http().get('/api/admin/bookings');

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        statusCode: 401,
        code: ErrorCode.NotAuthenticated,
        path: '/api/admin/bookings',
      });
    });

    it('rejects non-admin roles with 403 FORBIDDEN_ROLE', async () => {
      const nonAdminRoles = [
        UserRole.USER,
        UserRole.AIRLINE_MODERATOR,
        UserRole.HOTEL_MODERATOR,
      ];

      for (const role of nonAdminRoles) {
        const actor = await loginAs(testApp!.connection, role, {
          providerId: new Types.ObjectId().toHexString(),
        });
        const res = await testApp!
          .http()
          .get('/api/admin/bookings')
          .set('Cookie', actor.cookie);

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
          statusCode: 403,
          code: ErrorCode.ForbiddenRole,
          path: '/api/admin/bookings',
        });
      }
    });

    it('allows admin requests and returns mixed flight and hotel bookings newest first', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const res = await testApp!
        .http()
        .get('/api/admin/bookings?limit=50')
        .set('Cookie', admin.cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(12);
      expect(res.body.items).toHaveLength(12);
      expect(
        res.body.items.map((item: { bookingId: string }) => item.bookingId),
      ).toEqual([
        '6736f0b2c5a1b2c3d4e60001', // 2026-11-17 hotel
        '6736f0b2c5a1b2c3d4e50001', // 2026-11-16 flight
        '6736f0b2c5a1b2c3d4e50002', // 2026-11-15T23:59:59.999Z flight
        '6736f0b2c5a1b2c3d4e60002', // 2026-11-14 hotel
        '6736f0b2c5a1b2c3d4e50003', // 2026-11-13T12:00:00Z flight (tiebreak: flight < hotel)
        '6736f0b2c5a1b2c3d4e60003', // 2026-11-13T12:00:00Z hotel
        '6736f0b2c5a1b2c3d4e50004', // 2026-11-12 flight
        '6736f0b2c5a1b2c3d4e60004', // 2026-11-11 hotel
        '6736f0b2c5a1b2c3d4e60005', // 2026-11-10T18:00:00Z hotel
        '6736f0b2c5a1b2c3d4e50005', // 2026-11-10T00:00:00Z flight
        '6736f0b2c5a1b2c3d4e50006', // 2026-11-09 flight
        '6736f0b2c5a1b2c3d4e60006', // 2026-11-08 hotel
      ]);
    });
  });

  describe('Filters & Date Range Boundaries', () => {
    it('filters by type=flight and type=hotel independently', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const flightsRes = await testApp!
        .http()
        .get('/api/admin/bookings?type=flight')
        .set('Cookie', admin.cookie);
      expect(flightsRes.status).toBe(200);
      expect(flightsRes.body.total).toBe(6);
      expect(
        flightsRes.body.items.every(
          (item: { bookingType: string }) =>
            item.bookingType === BookingType.FLIGHT,
        ),
      ).toBe(true);

      const hotelsRes = await testApp!
        .http()
        .get('/api/admin/bookings?type=hotel')
        .set('Cookie', admin.cookie);
      expect(hotelsRes.status).toBe(200);
      expect(hotelsRes.body.total).toBe(6);
      expect(
        hotelsRes.body.items.every(
          (item: { bookingType: string }) =>
            item.bookingType === BookingType.HOTEL,
        ),
      ).toBe(true);
    });

    it('filters by status across both flights and hotels', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const confirmedRes = await testApp!
        .http()
        .get('/api/admin/bookings?status=confirmed')
        .set('Cookie', admin.cookie);
      expect(confirmedRes.status).toBe(200);
      expect(confirmedRes.body.total).toBe(6);
      expect(
        confirmedRes.body.items.every(
          (item: { status: string }) => item.status === 'confirmed',
        ),
      ).toBe(true);
    });

    it('treats from and to date bounds inclusively and excludes bookings outside', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const rangeRes = await testApp!
        .http()
        .get('/api/admin/bookings?from=2026-11-10&to=2026-11-15&limit=50')
        .set('Cookie', admin.cookie);

      expect(rangeRes.status).toBe(200);
      const ids = rangeRes.body.items.map(
        (item: { bookingId: string }) => item.bookingId,
      );
      expect(ids).toContain('6736f0b2c5a1b2c3d4e50005'); // start day 2026-11-10T00:00:00.000Z
      expect(ids).toContain('6736f0b2c5a1b2c3d4e50002'); // end day 2026-11-15T23:59:59.999Z
      expect(ids).not.toContain('6736f0b2c5a1b2c3d4e50006'); // 1 day before
      expect(ids).not.toContain('6736f0b2c5a1b2c3d4e60006'); // 2 days before
      expect(ids).not.toContain('6736f0b2c5a1b2c3d4e50001'); // 1 day after
      expect(ids).not.toContain('6736f0b2c5a1b2c3d4e60001'); // 2 days after
      expect(rangeRes.body.total).toBe(8);

      const fromOnly = await testApp!
        .http()
        .get('/api/admin/bookings?from=2026-11-16')
        .set('Cookie', admin.cookie);
      expect(fromOnly.status).toBe(200);
      expect(
        fromOnly.body.items.map(
          (item: { bookingId: string }) => item.bookingId,
        ),
      ).toEqual(['6736f0b2c5a1b2c3d4e60001', '6736f0b2c5a1b2c3d4e50001']);

      const toOnly = await testApp!
        .http()
        .get('/api/admin/bookings?to=2026-11-09')
        .set('Cookie', admin.cookie);
      expect(toOnly.status).toBe(200);
      expect(
        toOnly.body.items.map((item: { bookingId: string }) => item.bookingId),
      ).toEqual(['6736f0b2c5a1b2c3d4e50006', '6736f0b2c5a1b2c3d4e60006']);
    });

    it('combines type, status, from, and to with AND semantics', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const combined = await testApp!
        .http()
        .get(
          '/api/admin/bookings?type=flight&status=confirmed&from=2026-11-10&to=2026-11-15',
        )
        .set('Cookie', admin.cookie);

      expect(combined.status).toBe(200);
      expect(combined.body.total).toBe(2);
      expect(
        combined.body.items.map(
          (item: { bookingId: string }) => item.bookingId,
        ),
      ).toEqual(['6736f0b2c5a1b2c3d4e50002', '6736f0b2c5a1b2c3d4e50005']);
    });

    it('returns an empty paginated result when no bookings match filters', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const res = await testApp!
        .http()
        .get('/api/admin/bookings?from=2030-01-01&to=2030-01-02')
        .set('Cookie', admin.cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('Pagination, Validation, Read-Only & Response Shape', () => {
    it('enforces pagination defaults, boundaries, past-the-end, and page size limits', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const defaultPage = await testApp!
        .http()
        .get('/api/admin/bookings')
        .set('Cookie', admin.cookie);
      expect(defaultPage.status).toBe(200);
      expect(defaultPage.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      expect(defaultPage.body.items).toHaveLength(10);

      const lastPage = await testApp!
        .http()
        .get('/api/admin/bookings?page=2&limit=10')
        .set('Cookie', admin.cookie);
      expect(lastPage.status).toBe(200);
      expect(lastPage.body).toMatchObject({
        page: 2,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      expect(lastPage.body.items).toHaveLength(2);

      const pastEnd = await testApp!
        .http()
        .get('/api/admin/bookings?page=5&limit=10')
        .set('Cookie', admin.cookie);
      expect(pastEnd.status).toBe(200);
      expect(pastEnd.body).toEqual({
        items: [],
        page: 5,
        limit: 10,
        total: 12,
        totalPages: 2,
      });

      const maxLimit = await testApp!
        .http()
        .get('/api/admin/bookings?limit=50')
        .set('Cookie', admin.cookie);
      expect(maxLimit.status).toBe(200);
      expect(maxLimit.body.limit).toBe(50);

      for (const badQuery of ['limit=51', 'limit=0', 'page=0']) {
        const badRes = await testApp!
          .http()
          .get(`/api/admin/bookings?${badQuery}`)
          .set('Cookie', admin.cookie);
        expect(badRes.status).toBe(400);
        expect(badRes.body.code).toBe(ErrorCode.ValidationFailed);
        expect(badRes.body.details.length).toBeGreaterThan(0);
      }
    });

    it('returns 400 VALIDATION_FAILED with field details for invalid type, status, or dates', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const invalidQueries = [
        'type=car',
        'status=refunded',
        'from=not-a-date',
        'from=2026-11-10T00:00:00Z',
        'to=2026-02-29',
        'from=2026-11-20&to=2026-11-10',
      ];

      for (const query of invalidQueries) {
        const res = await testApp!
          .http()
          .get(`/api/admin/bookings?${query}`)
          .set('Cookie', admin.cookie);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          statusCode: 400,
          code: ErrorCode.ValidationFailed,
        });
        expect(res.body.details.length).toBeGreaterThan(0);
      }
    });

    it('rejects all write HTTP methods on /api/admin/bookings', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const postRes = await testApp!
        .http()
        .post('/api/admin/bookings')
        .set('Cookie', admin.cookie)
        .send({});
      expect(postRes.status).toBe(404);

      const patchRes = await testApp!
        .http()
        .patch('/api/admin/bookings')
        .set('Cookie', admin.cookie)
        .send({});
      expect(patchRes.status).toBe(404);

      const putRes = await testApp!
        .http()
        .put('/api/admin/bookings')
        .set('Cookie', admin.cookie)
        .send({});
      expect(putRes.status).toBe(404);

      const deleteRes = await testApp!
        .http()
        .delete('/api/admin/bookings')
        .set('Cookie', admin.cookie);
      expect(deleteRes.status).toBe(404);
    });

    it('returns only the documented CTR-04 fields with no extra or payment fields', async () => {
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const res = await testApp!
        .http()
        .get('/api/admin/bookings?limit=50')
        .set('Cookie', admin.cookie);

      expect(res.status).toBe(200);
      for (const item of res.body.items as Array<Record<string, unknown>>) {
        const keys = Object.keys(item).sort();
        const expectedKeys =
          'reference' in item
            ? ALLOWED_KEYS_WITH_REFERENCE
            : ALLOWED_KEYS_WITHOUT_REFERENCE;
        expect(keys).toEqual(expectedKeys);
        expect(typeof item.userId).toBe('string');
      }
    });
  });

  describe('Empty dataset store', () => {
    let emptyApp: TestApp | undefined;

    beforeAll(async () => {
      emptyApp = await createTestApp({
        imports: [AdminModule],
        override: (builder) =>
          builder
            .overrideProvider(FlightBookingsService)
            .useValue(new FakeFlightBookingsService([]))
            .overrideProvider(HotelBookingsService)
            .useValue(new FakeHotelBookingsService([])),
      });
    }, HOOK_TIMEOUT);

    afterAll(async () => {
      await emptyApp?.close();
    }, HOOK_TIMEOUT);

    it('returns valid empty paginated envelope when no bookings exist anywhere', async () => {
      const admin = await loginAs(emptyApp!.connection, UserRole.ADMIN);

      const res = await emptyApp!
        .http()
        .get('/api/admin/bookings')
        .set('Cookie', admin.cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('Tied CreatedAt Paging & Page Depth Cap (ACC-17)', () => {
    let tieApp: TestApp | undefined;
    const fakeFlights = new FakeFlightBookingsService();
    const fakeHotels = new FakeHotelBookingsService();

    const makeFlight = (
      bookingId: string,
      createdAt: Date,
    ): FlightBookingAdminView => ({
      bookingType: BookingType.FLIGHT,
      bookingId,
      reference: `FB-${bookingId}`,
      userId: makeId('a'),
      providerId: makeId('1'),
      startAt: new Date('2026-12-10T08:00:00.000Z'),
      endAt: new Date('2026-12-10T11:00:00.000Z'),
      totalMinor: 25000,
      currency: 'USD',
      status: 'confirmed',
      createdAt,
    });

    const makeHotel = (
      bookingId: string,
      createdAt: Date,
    ): HotelReservationAdminView => ({
      bookingType: BookingType.HOTEL,
      bookingId,
      reference: `HB-${bookingId}`,
      userId: makeId('b'),
      providerId: makeId('2'),
      startAt: new Date('2026-12-12T15:00:00.000Z'),
      endAt: new Date('2026-12-15T11:00:00.000Z'),
      totalMinor: 42000,
      currency: 'USD',
      status: 'confirmed',
      createdAt,
    });

    beforeAll(async () => {
      tieApp = await createTestApp({
        imports: [AdminModule],
        override: (builder) =>
          builder
            .overrideProvider(FlightBookingsService)
            .useValue(fakeFlights)
            .overrideProvider(HotelBookingsService)
            .useValue(fakeHotels),
      });
    }, HOOK_TIMEOUT);

    beforeEach(() => {
      vi.restoreAllMocks();
      Object.assign(fakeFlights, new FakeFlightBookingsService([]));
      Object.assign(fakeHotels, new FakeHotelBookingsService([]));
    });

    afterAll(async () => {
      await tieApp?.close();
    }, HOOK_TIMEOUT);

    it('pages without duplicates or gaps across limits 1, 2, and 5 for same-type ties, cross-type ties, and distinct timestamps', async () => {
      const admin = await loginAs(tieApp!.connection, UserRole.ADMIN);
      const tiedTs = new Date('2026-11-11T12:00:00.000Z');

      const datasets: Array<{
        name: string;
        flights: FlightBookingAdminView[];
        hotels: HotelReservationAdminView[];
        expectedOrder: string[];
      }> = [
        {
          name: '3 flights sharing createdAt plus 2 hotels (exact reproduction)',
          flights: [
            makeFlight('f-c', tiedTs),
            makeFlight('f-b', tiedTs),
            makeFlight('f-a', tiedTs),
          ],
          hotels: [
            makeHotel('h-2', new Date('2026-11-12T12:00:00.000Z')),
            makeHotel('h-1', new Date('2026-11-10T12:00:00.000Z')),
          ],
          expectedOrder: ['h-2', 'f-c', 'f-b', 'f-a', 'h-1'],
        },
        {
          name: '3 hotels sharing createdAt plus 2 flights',
          flights: [
            makeFlight('f-new', new Date('2026-11-12T12:00:00.000Z')),
            makeFlight('f-old', new Date('2026-11-10T12:00:00.000Z')),
          ],
          hotels: [
            makeHotel('h-c', tiedTs),
            makeHotel('h-b', tiedTs),
            makeHotel('h-a', tiedTs),
          ],
          expectedOrder: ['f-new', 'h-c', 'h-b', 'h-a', 'f-old'],
        },
        {
          name: 'flights and hotels sharing the same createdAt',
          flights: [
            makeFlight('f-c', tiedTs),
            makeFlight('f-b', tiedTs),
            makeFlight('f-a', tiedTs),
          ],
          hotels: [makeHotel('h-b', tiedTs), makeHotel('h-a', tiedTs)],
          expectedOrder: ['f-c', 'f-b', 'f-a', 'h-b', 'h-a'],
        },
        {
          name: 'control with all-distinct createdAt',
          flights: [
            makeFlight('f-1', new Date('2026-11-14T12:00:00.000Z')),
            makeFlight('f-2', new Date('2026-11-12T12:00:00.000Z')),
            makeFlight('f-3', new Date('2026-11-10T12:00:00.000Z')),
          ],
          hotels: [
            makeHotel('h-1', new Date('2026-11-15T12:00:00.000Z')),
            makeHotel('h-2', new Date('2026-11-13T12:00:00.000Z')),
          ],
          expectedOrder: ['h-1', 'f-1', 'h-2', 'f-2', 'f-3'],
        },
      ];

      for (const dataset of datasets) {
        Object.assign(
          fakeFlights,
          new FakeFlightBookingsService(dataset.flights),
        );
        Object.assign(fakeHotels, new FakeHotelBookingsService(dataset.hotels));

        const singleRes = await tieApp!
          .http()
          .get('/api/admin/bookings?limit=50')
          .set('Cookie', admin.cookie);
        expect(singleRes.status).toBe(200);
        const fullIds = (
          singleRes.body.items as Array<{ bookingId: string }>
        ).map((item) => item.bookingId);

        for (const limit of [1, 2, 5]) {
          const totalPages = Math.ceil(dataset.expectedOrder.length / limit);
          const collected: string[] = [];
          for (let page = 1; page <= totalPages; page += 1) {
            const pageRes = await tieApp!
              .http()
              .get(`/api/admin/bookings?page=${page}&limit=${limit}`)
              .set('Cookie', admin.cookie);
            expect(pageRes.status).toBe(200);
            expect(pageRes.body.total).toBe(dataset.expectedOrder.length);
            expect(pageRes.body.totalPages).toBe(totalPages);
            collected.push(
              ...(pageRes.body.items as Array<{ bookingId: string }>).map(
                (item) => item.bookingId,
              ),
            );
          }

          expect(collected).toHaveLength(dataset.expectedOrder.length);
          expect(new Set(collected).size).toBe(dataset.expectedOrder.length);
          expect(new Set(collected)).toEqual(new Set(dataset.expectedOrder));
          expect(collected).toEqual(dataset.expectedOrder);
          expect(collected).toEqual(fullIds);

          const pastEndRes = await tieApp!
            .http()
            .get(`/api/admin/bookings?page=${totalPages + 1}&limit=${limit}`)
            .set('Cookie', admin.cookie);
          expect(pastEndRes.status).toBe(200);
          expect(pastEndRes.body.items).toEqual([]);
        }

        expect(fullIds).toEqual(dataset.expectedOrder);
      }
    });

    it('enforces the 10000 page * limit cap and rejects out-of-bounds page values without calling booking services', async () => {
      const admin = await loginAs(tieApp!.connection, UserRole.ADMIN);

      for (const queryStr of ['page=200&limit=50', 'page=10000&limit=1']) {
        const res = await tieApp!
          .http()
          .get(`/api/admin/bookings?${queryStr}`)
          .set('Cookie', admin.cookie);
        expect(res.status).toBe(200);
        expect(res.body.items).toEqual([]);
      }

      const flightsSpy = vi.spyOn(fakeFlights, 'listForAdmin');
      const hotelsSpy = vi.spyOn(fakeHotels, 'listForAdmin');

      for (const queryStr of [
        'page=201&limit=50',
        'page=10001&limit=1',
        'page=1000000&limit=50',
        'page=1e300',
        'page=abc',
      ]) {
        flightsSpy.mockClear();
        hotelsSpy.mockClear();

        const res = await tieApp!
          .http()
          .get(`/api/admin/bookings?${queryStr}`)
          .set('Cookie', admin.cookie);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
        expect(
          res.body.details.map((detail: { field: string }) => detail.field),
        ).toContain('page');
        expect(flightsSpy).not.toHaveBeenCalled();
        expect(hotelsSpy).not.toHaveBeenCalled();
      }
    });
  });
});
