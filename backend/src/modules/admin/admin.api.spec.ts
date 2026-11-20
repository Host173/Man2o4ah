import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types, type Model } from 'mongoose';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FakeAccountsService } from '../../../test/fakes/accounts.fake.js';
import { FakeFlightBookingsService } from '../../../test/fakes/flight-bookings.fake.js';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakeHotelBookingsService } from '../../../test/fakes/hotel-bookings.fake.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakeItinerariesService } from '../../../test/fakes/itineraries.fake.js';
import { FakeReportableContent } from '../../../test/fakes/reportable-content.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  ProviderType,
  UserRole,
  UserStatus,
} from '../accounts/schemas/user.schema.js';
import { AuditAction } from '../audit/schemas/audit-log.schema.js';
import { BlogModule } from '../blog/blog.module.js';
import { ItineraryReportableContent } from '../itineraries/itinerary-reportable-content.js';
import {
  Comment,
  type CommentDocument,
} from '../blog/schemas/comment.schema.js';
import { Like, type LikeDocument } from '../blog/schemas/like.schema.js';
import {
  Post,
  PostStatus,
  type PostDocument,
} from '../blog/schemas/post.schema.js';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service.js';
import type { FlightBookingAdminView } from '../flight-bookings/flight-bookings.types.js';
import { FlightsService } from '../flights/flights.service.js';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service.js';
import type { HotelReservationAdminView } from '../hotel-bookings/hotel-bookings.types.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { ItinerariesService } from '../itineraries/itineraries.service.js';
import { ReportResolutionAction } from '../moderation/dto/resolve-report.dto.js';
import { ReportableContentRegistry } from '../moderation/ports/reportable-content.registry.js';
import {
  Report,
  ReportStatus,
  ReportTargetType,
} from '../moderation/schemas/report.schema.js';
import { StorageService } from '../storage/storage.service.js';
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

    it('clamps merged totalPages to reachable 10000-depth pages and rejects last+1 without calling services', async () => {
      const admin = await loginAs(tieApp!.connection, UserRole.ADMIN);
      const baseMs = Date.parse('2026-11-18T00:00:00.000Z');
      const flights10k = Array.from({ length: 10_000 }, (_, idx) =>
        makeFlight(`f-${idx}`, new Date(baseMs - idx * 2_000)),
      );
      const hotels10k = Array.from({ length: 10_000 }, (_, idx) =>
        makeHotel(`h-${idx}`, new Date(baseMs - (idx * 2 + 1) * 1_000)),
      );
      Object.assign(fakeFlights, new FakeFlightBookingsService(flights10k));
      Object.assign(fakeHotels, new FakeHotelBookingsService(hotels10k));
      const flightsSpy = vi.spyOn(fakeFlights, 'listForAdmin');
      const hotelsSpy = vi.spyOn(fakeHotels, 'listForAdmin');

      for (const [limit, expectedTotalPages] of [
        [50, 200],
        [1, 10_000],
        [7, 1428],
      ] as const) {
        const lastRes = await tieApp!
          .http()
          .get(`/api/admin/bookings?page=${expectedTotalPages}&limit=${limit}`)
          .set('Cookie', admin.cookie);
        expect(lastRes.status).toBe(200);
        expect(lastRes.body.total).toBe(20_000);
        expect(lastRes.body.totalPages).toBe(expectedTotalPages);
        expect(lastRes.body.items).toHaveLength(limit);

        flightsSpy.mockClear();
        hotelsSpy.mockClear();
        const overRes = await tieApp!
          .http()
          .get(
            `/api/admin/bookings?page=${expectedTotalPages + 1}&limit=${limit}`,
          )
          .set('Cookie', admin.cookie);
        expect(overRes.status).toBe(400);
        expect(overRes.body.code).toBe(ErrorCode.ValidationFailed);
        expect(
          overRes.body.details.map((detail: { field: string }) => detail.field),
        ).toContain('page');
        expect(flightsSpy).not.toHaveBeenCalled();
        expect(hotelsSpy).not.toHaveBeenCalled();
      }

      Object.assign(
        fakeFlights,
        new FakeFlightBookingsService(flights10k.slice(0, 60)),
      );
      Object.assign(
        fakeHotels,
        new FakeHotelBookingsService(hotels10k.slice(0, 60)),
      );

      const smallLastRes = await tieApp!
        .http()
        .get('/api/admin/bookings?page=3&limit=50')
        .set('Cookie', admin.cookie);
      expect(smallLastRes.status).toBe(200);
      expect(smallLastRes.body.total).toBe(120);
      expect(smallLastRes.body.totalPages).toBe(3);
      expect(smallLastRes.body.items).toHaveLength(20);

      const smallBeyondRes = await tieApp!
        .http()
        .get('/api/admin/bookings?page=4&limit=50')
        .set('Cookie', admin.cookie);
      expect(smallBeyondRes.status).toBe(200);
      expect(smallBeyondRes.body.total).toBe(120);
      expect(smallBeyondRes.body.totalPages).toBe(3);
      expect(smallBeyondRes.body.items).toEqual([]);
    });

    it('serves single-type queries past 10000 depth without clamping totalPages', async () => {
      const admin = await loginAs(tieApp!.connection, UserRole.ADMIN);
      const baseMs = Date.parse('2026-11-18T00:00:00.000Z');
      const flights20k = Array.from({ length: 20_000 }, (_, idx) =>
        makeFlight(`f-${idx}`, new Date(baseMs - idx * 1_000)),
      );
      Object.assign(fakeFlights, new FakeFlightBookingsService(flights20k));
      Object.assign(fakeHotels, new FakeHotelBookingsService([]));
      const flightsSpy = vi.spyOn(fakeFlights, 'listForAdmin');
      const hotelsSpy = vi.spyOn(fakeHotels, 'listForAdmin');

      const flightRes = await tieApp!
        .http()
        .get('/api/admin/bookings?type=flight&page=201&limit=50')
        .set('Cookie', admin.cookie);
      expect(flightRes.status).toBe(200);
      expect(flightRes.body.total).toBe(20_000);
      expect(flightRes.body.totalPages).toBe(400);
      expect(flightRes.body.items).toHaveLength(50);
      expect(flightsSpy).toHaveBeenCalledTimes(1);
      expect(flightsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ page: 201, limit: 50 }),
      );
      expect(hotelsSpy).not.toHaveBeenCalled();

      const flightLastRes = await tieApp!
        .http()
        .get('/api/admin/bookings?type=flight&page=400&limit=50')
        .set('Cookie', admin.cookie);
      expect(flightLastRes.status).toBe(200);
      expect(flightLastRes.body.items).toHaveLength(50);

      const flightBeyondRes = await tieApp!
        .http()
        .get('/api/admin/bookings?type=flight&page=401&limit=50')
        .set('Cookie', admin.cookie);
      expect(flightBeyondRes.status).toBe(200);
      expect(flightBeyondRes.body.items).toEqual([]);

      flightsSpy.mockClear();
      hotelsSpy.mockClear();

      const hotels20k = Array.from({ length: 20_000 }, (_, idx) =>
        makeHotel(`h-${idx}`, new Date(baseMs - idx * 1_000)),
      );
      Object.assign(fakeFlights, new FakeFlightBookingsService([]));
      Object.assign(fakeHotels, new FakeHotelBookingsService(hotels20k));

      const hotelRes = await tieApp!
        .http()
        .get('/api/admin/bookings?type=hotel&page=201&limit=50')
        .set('Cookie', admin.cookie);
      expect(hotelRes.status).toBe(200);
      expect(hotelRes.body.total).toBe(20_000);
      expect(hotelRes.body.totalPages).toBe(400);
      expect(hotelRes.body.items).toHaveLength(50);
      expect(hotelsSpy).toHaveBeenCalledTimes(1);
      expect(hotelsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ page: 201, limit: 50 }),
      );
      expect(flightsSpy).not.toHaveBeenCalled();

      const hotelLastRes = await tieApp!
        .http()
        .get('/api/admin/bookings?type=hotel&page=400&limit=50')
        .set('Cookie', admin.cookie);
      expect(hotelLastRes.status).toBe(200);
      expect(hotelLastRes.body.items).toHaveLength(50);

      const hotelBeyondRes = await tieApp!
        .http()
        .get('/api/admin/bookings?type=hotel&page=401&limit=50')
        .set('Cookie', admin.cookie);
      expect(hotelBeyondRes.status).toBe(200);
      expect(hotelBeyondRes.body.items).toEqual([]);
    });

    it('rejects page=1e300 and page=10001 on both unfiltered and type-filtered requests without calling services', async () => {
      const admin = await loginAs(tieApp!.connection, UserRole.ADMIN);
      const flightsSpy = vi.spyOn(fakeFlights, 'listForAdmin');
      const hotelsSpy = vi.spyOn(fakeHotels, 'listForAdmin');

      for (const prefix of ['', 'type=flight&', 'type=hotel&']) {
        for (const pageVal of ['1e300', '10001']) {
          flightsSpy.mockClear();
          hotelsSpy.mockClear();

          const res = await tieApp!
            .http()
            .get(`/api/admin/bookings?${prefix}page=${pageVal}`)
            .set('Cookie', admin.cookie);
          expect(res.status).toBe(400);
          expect(res.body.code).toBe(ErrorCode.ValidationFailed);
          expect(
            res.body.details.map((detail: { field: string }) => detail.field),
          ).toContain('page');
          expect(flightsSpy).not.toHaveBeenCalled();
          expect(hotelsSpy).not.toHaveBeenCalled();
        }
      }
    });
  });
});

describe('Admin Moderation API (GEN-10)', () => {
  let modApp: TestApp | undefined;
  const fakeAccounts = new FakeAccountsService();
  const fakeItineraries = new FakeItinerariesService();
  const fakeStorage = new FakeStorageService();
  const fakeEvents = new FakeEvents();
  const reviewsFake = new FakeReportableContent(ReportTargetType.REVIEW);
  const itinerariesFake = new FakeReportableContent(ReportTargetType.ITINERARY);

  let postModel: Model<PostDocument>;
  let commentModel: Model<CommentDocument>;
  let likeModel: Model<LikeDocument>;
  let reportModel: Model<Report>;

  beforeAll(async () => {
    modApp = await createTestApp({
      imports: [AdminModule, BlogModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightBookingsService)
          .useValue(new FakeFlightBookingsService([]))
          .overrideProvider(HotelBookingsService)
          .useValue(new FakeHotelBookingsService([]))
          .overrideProvider(AccountsService)
          .useValue(fakeAccounts)
          .overrideProvider(ItinerariesService)
          .useValue(fakeItineraries)
          .overrideProvider(StorageService)
          .useValue(fakeStorage)
          .overrideProvider(AppEvents)
          .useValue(fakeEvents)
          // This suite seeds its own in-memory itinerary provider below; keep
          // the real ITN-20 provider from registering a second one.
          .overrideProvider(ItineraryReportableContent)
          .useValue({ onModuleInit: () => {} }),
    });

    const registry = modApp.moduleRef.get(ReportableContentRegistry);
    registry.register(reviewsFake);
    registry.register(itinerariesFake);

    postModel = modApp.moduleRef.get<Model<PostDocument>>(
      getModelToken(Post.name),
    );
    commentModel = modApp.moduleRef.get<Model<CommentDocument>>(
      getModelToken(Comment.name),
    );
    likeModel = modApp.moduleRef.get<Model<LikeDocument>>(
      getModelToken(Like.name),
    );
    reportModel = modApp.moduleRef.get<Model<Report>>(
      getModelToken(Report.name),
    );
    await reportModel.init();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(modApp!.connection);
    Object.assign(fakeAccounts, new FakeAccountsService());
    Object.assign(fakeItineraries, new FakeItinerariesService());
    Object.assign(fakeStorage, new FakeStorageService());
    fakeEvents.clear();
    reviewsFake.clear();
    itinerariesFake.clear();
  });

  afterAll(async () => {
    await modApp?.close();
  }, HOOK_TIMEOUT);

  it('registers Swagger metadata for GEN-10 admin moderation endpoints', () => {
    const document = SwaggerModule.createDocument(
      modApp!.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );

    const reportsList = document.paths['/api/admin/reports']?.get;
    expect(reportsList).toBeDefined();
    expect(reportsList?.tags).toContain('admin');
    expect(reportsList?.security).toBeDefined();
    expect(reportsList?.responses?.['200']).toBeDefined();

    const reportResolve = document.paths['/api/admin/reports/{id}']?.patch;
    expect(reportResolve).toBeDefined();
    expect(reportResolve?.tags).toContain('admin');
    expect(reportResolve?.security).toBeDefined();
    expect(reportResolve?.responses?.['200']).toBeDefined();
    expect(reportResolve?.responses?.['409']).toBeDefined();

    const directHide =
      document.paths['/api/admin/content/{type}/{id}/hide']?.patch;
    expect(directHide).toBeDefined();
    expect(directHide?.tags).toContain('admin');
    expect(directHide?.security).toBeDefined();
    expect(directHide?.responses?.['204']).toBeDefined();

    const directDelete =
      document.paths['/api/admin/content/{type}/{id}']?.delete;
    expect(directDelete).toBeDefined();
    expect(directDelete?.tags).toContain('admin');
    expect(directDelete?.security).toBeDefined();
    expect(directDelete?.responses?.['204']).toBeDefined();
  });

  it('enforces 401 NOT_AUTHENTICATED and 403 FORBIDDEN_ROLE across all GEN-10 endpoints', async () => {
    const sampleId = new Types.ObjectId().toHexString();
    const checks: (() => Promise<{
      status: number;
      body: { code?: string };
    }>)[] = [
      () => modApp!.http().get('/api/admin/reports'),
      () =>
        modApp!
          .http()
          .patch(`/api/admin/reports/${sampleId}`)
          .send({ action: ReportResolutionAction.DISMISS }),
      () =>
        modApp!
          .http()
          .patch(
            `/api/admin/content/${ReportTargetType.POST}/${sampleId}/hide`,
          ),
      () =>
        modApp!
          .http()
          .delete(`/api/admin/content/${ReportTargetType.POST}/${sampleId}`),
    ];

    for (const call of checks) {
      const unauth = await call();
      expect(unauth.status).toBe(401);
      expect(unauth.body.code).toBe(ErrorCode.NotAuthenticated);
    }

    const nonAdminRoles = [
      UserRole.USER,
      UserRole.AIRLINE_MODERATOR,
      UserRole.HOTEL_MODERATOR,
    ];
    for (const role of nonAdminRoles) {
      const actor = await loginAs(modApp!.connection, role, {
        providerId: new Types.ObjectId().toHexString(),
      });

      const listRes = await modApp!
        .http()
        .get('/api/admin/reports')
        .set('Cookie', actor.cookie);
      expect(listRes.status).toBe(403);
      expect(listRes.body.code).toBe(ErrorCode.ForbiddenRole);

      const resolveRes = await modApp!
        .http()
        .patch(`/api/admin/reports/${sampleId}`)
        .set('Cookie', actor.cookie)
        .send({ action: ReportResolutionAction.DISMISS });
      expect(resolveRes.status).toBe(403);
      expect(resolveRes.body.code).toBe(ErrorCode.ForbiddenRole);

      const hideRes = await modApp!
        .http()
        .patch(`/api/admin/content/${ReportTargetType.POST}/${sampleId}/hide`)
        .set('Cookie', actor.cookie);
      expect(hideRes.status).toBe(403);
      expect(hideRes.body.code).toBe(ErrorCode.ForbiddenRole);

      const deleteRes = await modApp!
        .http()
        .delete(`/api/admin/content/${ReportTargetType.POST}/${sampleId}`)
        .set('Cookie', actor.cookie);
      expect(deleteRes.status).toBe(403);
      expect(deleteRes.body.code).toBe(ErrorCode.ForbiddenRole);
    }
  });

  it('lists reports with default status=open, explicit status filters, pagination bounds, and validation errors', async () => {
    const admin = await loginAs(modApp!.connection, UserRole.ADMIN);
    const reporterA = await loginAs(modApp!.connection, UserRole.USER);
    const reporterB = await loginAs(modApp!.connection, UserRole.USER);

    const review1 = new Types.ObjectId().toHexString();
    const review2 = new Types.ObjectId().toHexString();
    const review3 = new Types.ObjectId().toHexString();
    reviewsFake.add(review1);
    reviewsFake.add(review2);
    reviewsFake.add(review3);

    const openOlder = await reportModel.create({
      reporterId: new Types.ObjectId(reporterA.id),
      targetType: ReportTargetType.REVIEW,
      targetId: new Types.ObjectId(review1),
      reason: 'Open 1',
      status: ReportStatus.OPEN,
    });
    const openNewer = await reportModel.create({
      reporterId: new Types.ObjectId(reporterB.id),
      targetType: ReportTargetType.REVIEW,
      targetId: new Types.ObjectId(review2),
      reason: 'Open 2',
      status: ReportStatus.OPEN,
    });
    await reportModel.updateOne(
      { _id: openOlder._id },
      { $set: { createdAt: new Date('2026-11-10T09:00:00.000Z') } },
    );
    await reportModel.updateOne(
      { _id: openNewer._id },
      { $set: { createdAt: new Date('2026-11-11T09:00:00.000Z') } },
    );
    const dismissedDoc = await reportModel.create({
      reporterId: new Types.ObjectId(reporterA.id),
      targetType: ReportTargetType.REVIEW,
      targetId: new Types.ObjectId(review3),
      reason: 'Already dismissed',
      status: ReportStatus.DISMISSED,
      resolvedBy: new Types.ObjectId(admin.id),
      resolvedAt: new Date('2026-11-12T09:00:00.000Z'),
    });

    const defaultRes = await modApp!
      .http()
      .get('/api/admin/reports')
      .set('Cookie', admin.cookie);
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body.total).toBe(2);
    expect(defaultRes.body.items.map((r: { _id: string }) => r._id)).toEqual([
      openNewer._id.toHexString(),
      openOlder._id.toHexString(),
    ]);

    const dismissedRes = await modApp!
      .http()
      .get(`/api/admin/reports?status=${ReportStatus.DISMISSED}&limit=50`)
      .set('Cookie', admin.cookie);
    expect(dismissedRes.status).toBe(200);
    expect(dismissedRes.body.total).toBe(1);
    expect(dismissedRes.body.items[0]._id).toBe(dismissedDoc._id.toHexString());

    const pagedRes = await modApp!
      .http()
      .get('/api/admin/reports?page=2&limit=1')
      .set('Cookie', admin.cookie);
    expect(pagedRes.status).toBe(200);
    expect(pagedRes.body.items.map((r: { _id: string }) => r._id)).toEqual([
      openOlder._id.toHexString(),
    ]);
    expect(pagedRes.body.totalPages).toBe(2);

    for (const badQuery of [
      'status=pending',
      'limit=51',
      'limit=0',
      'page=0',
    ]) {
      const invalidRes = await modApp!
        .http()
        .get(`/api/admin/reports?${badQuery}`)
        .set('Cookie', admin.cookie);
      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.code).toBe(ErrorCode.ValidationFailed);
    }
  });

  it('resolves reports (dismiss, hide, delete) across real blog posts/comments and fake review/itinerary targets, handling errors properly', async () => {
    const admin = await loginAs(modApp!.connection, UserRole.ADMIN);
    const author = await loginAs(modApp!.connection, UserRole.USER);
    const reporter1 = await loginAs(modApp!.connection, UserRole.USER);
    const reporter2 = await loginAs(modApp!.connection, UserRole.USER);

    const savedImage = await fakeStorage.save({
      originalname: 'cover.png',
      mimetype: 'image/png',
      size: 16,
      buffer: Buffer.from('fake-png-bytes!!'),
    });
    const postDoc = await postModel.create({
      authorId: new Types.ObjectId(author.id),
      title: 'Reported Blog Post',
      body: 'Post body with image and comments.',
      tags: ['travel'],
      images: [savedImage],
      status: PostStatus.PUBLISHED,
      publishedAt: new Date(),
      commentCount: 2,
      likeCount: 1,
    });
    const comment1Doc = await commentModel.create({
      postId: postDoc._id,
      authorId: new Types.ObjectId(reporter1.id),
      body: 'Comment to hide first',
    });
    await commentModel.create({
      postId: postDoc._id,
      authorId: new Types.ObjectId(reporter2.id),
      body: 'Second comment',
    });
    await likeModel.create({
      postId: postDoc._id,
      userId: new Types.ObjectId(reporter1.id),
    });

    // 1) Report comment -> hide closes sibling report, decrements post commentCount, emits both events.
    const cReport1 = await reportModel.create({
      reporterId: new Types.ObjectId(author.id),
      targetType: ReportTargetType.COMMENT,
      targetId: comment1Doc._id,
      reason: 'Abusive comment',
    });
    const cReport2 = await reportModel.create({
      reporterId: new Types.ObjectId(reporter2.id),
      targetType: ReportTargetType.COMMENT,
      targetId: comment1Doc._id,
      reason: 'Also flagged',
    });

    const hideCommentRes = await modApp!
      .http()
      .patch(`/api/admin/reports/${cReport1._id.toHexString()}`)
      .set('Cookie', admin.cookie)
      .send({ action: ReportResolutionAction.HIDE });
    expect(hideCommentRes.status).toBe(200);
    expect(hideCommentRes.body).toMatchObject({
      _id: cReport1._id.toHexString(),
      status: ReportStatus.CONTENT_HIDDEN,
      resolvedBy: admin.id,
    });
    expect(
      (await commentModel.findById(comment1Doc._id).lean())?.isHidden,
    ).toBe(true);
    expect((await postModel.findById(postDoc._id).lean())?.commentCount).toBe(
      1,
    );
    expect((await reportModel.findById(cReport2._id).lean())?.status).toBe(
      ReportStatus.CONTENT_HIDDEN,
    );
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.REPORT_RESOLVED,
        target: { type: 'report', id: cReport1._id.toHexString() },
        details: {
          action: ReportResolutionAction.HIDE,
          status: ReportStatus.CONTENT_HIDDEN,
          targetType: ReportTargetType.COMMENT,
          targetId: comment1Doc._id.toHexString(),
          closedCount: 2,
        },
      },
      {
        actorId: admin.id,
        action: AuditAction.CONTENT_HIDDEN,
        target: {
          type: ReportTargetType.COMMENT,
          id: comment1Doc._id.toHexString(),
        },
        details: { reportId: cReport1._id.toHexString() },
      },
    ]);

    // Resolving an already-resolved report returns 409 INVALID_STATUS_TRANSITION and emits no events.
    fakeEvents.clear();
    const conflictRes = await modApp!
      .http()
      .patch(`/api/admin/reports/${cReport2._id.toHexString()}`)
      .set('Cookie', admin.cookie)
      .send({ action: ReportResolutionAction.DISMISS });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.code).toBe(ErrorCode.InvalidStatusTransition);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);

    // 2) Report post -> delete cascades comments, likes, and FakeStorageService image keys.
    const postReport = await reportModel.create({
      reporterId: new Types.ObjectId(reporter1.id),
      targetType: ReportTargetType.POST,
      targetId: postDoc._id,
      reason: 'Severe policy breach',
    });
    const deletePostRes = await modApp!
      .http()
      .patch(`/api/admin/reports/${postReport._id.toHexString()}`)
      .set('Cookie', admin.cookie)
      .send({ action: ReportResolutionAction.DELETE });
    expect(deletePostRes.status).toBe(200);
    expect(deletePostRes.body.status).toBe(ReportStatus.CONTENT_DELETED);
    expect(await postModel.findById(postDoc._id).lean()).toBeNull();
    expect(await commentModel.countDocuments({ postId: postDoc._id })).toBe(0);
    expect(await likeModel.countDocuments({ postId: postDoc._id })).toBe(0);
    expect(fakeStorage.has(savedImage.key)).toBe(false);

    // 3) Missing content on hide/delete -> 404 NOT_FOUND and report stays open, whereas dismiss succeeds!
    fakeEvents.clear();
    const deletedItineraryId = new Types.ObjectId();
    const orphanReport = await reportModel.create({
      reporterId: new Types.ObjectId(reporter1.id),
      targetType: ReportTargetType.ITINERARY,
      targetId: deletedItineraryId,
      reason: 'Target already removed',
    });
    const missingHideRes = await modApp!
      .http()
      .patch(`/api/admin/reports/${orphanReport._id.toHexString()}`)
      .set('Cookie', admin.cookie)
      .send({ action: ReportResolutionAction.HIDE });
    expect(missingHideRes.status).toBe(404);
    expect(missingHideRes.body.code).toBe(ErrorCode.NotFound);
    expect((await reportModel.findById(orphanReport._id).lean())?.status).toBe(
      ReportStatus.OPEN,
    );
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);

    const dismissOrphanRes = await modApp!
      .http()
      .patch(`/api/admin/reports/${orphanReport._id.toHexString()}`)
      .set('Cookie', admin.cookie)
      .send({ action: ReportResolutionAction.DISMISS });
    expect(dismissOrphanRes.status).toBe(200);
    expect(dismissOrphanRes.body.status).toBe(ReportStatus.DISMISSED);

    // 4) Validation & missing report ID errors.
    const badReportId = await modApp!
      .http()
      .patch('/api/admin/reports/not-an-id')
      .set('Cookie', admin.cookie)
      .send({ action: ReportResolutionAction.DISMISS });
    expect(badReportId.status).toBe(400);
    expect(badReportId.body.code).toBe(ErrorCode.ValidationFailed);

    const badAction = await modApp!
      .http()
      .patch(`/api/admin/reports/${orphanReport._id.toHexString()}`)
      .set('Cookie', admin.cookie)
      .send({ action: 'ban' });
    expect(badAction.status).toBe(400);
    expect(badAction.body.code).toBe(ErrorCode.ValidationFailed);

    const unknownReport = await modApp!
      .http()
      .patch(`/api/admin/reports/${new Types.ObjectId().toHexString()}`)
      .set('Cookie', admin.cookie)
      .send({ action: ReportResolutionAction.DISMISS });
    expect(unknownReport.status).toBe(404);
    expect(unknownReport.body.code).toBe(ErrorCode.NotFound);
  });

  it('supports direct hide and delete across all four content types (204, closes open reports, emits audit events, validates inputs)', async () => {
    const admin = await loginAs(modApp!.connection, UserRole.ADMIN);
    const author = await loginAs(modApp!.connection, UserRole.USER);
    const reporter = await loginAs(modApp!.connection, UserRole.USER);

    const postDoc = await postModel.create({
      authorId: new Types.ObjectId(author.id),
      title: 'Direct Moderation Post',
      body: 'Body text',
      status: PostStatus.PUBLISHED,
      publishedAt: new Date(),
      commentCount: 1,
    });
    const commentDoc = await commentModel.create({
      postId: postDoc._id,
      authorId: new Types.ObjectId(reporter.id),
      body: 'Direct delete comment',
    });
    const reviewId = new Types.ObjectId().toHexString();
    const itineraryId = new Types.ObjectId().toHexString();
    reviewsFake.add(reviewId);
    itinerariesFake.add(itineraryId);

    const openReviewReport = await reportModel.create({
      reporterId: new Types.ObjectId(reporter.id),
      targetType: ReportTargetType.REVIEW,
      targetId: new Types.ObjectId(reviewId),
      reason: 'Hide review directly',
    });
    const openItineraryReport = await reportModel.create({
      reporterId: new Types.ObjectId(reporter.id),
      targetType: ReportTargetType.ITINERARY,
      targetId: new Types.ObjectId(itineraryId),
      reason: 'Delete itinerary directly',
    });

    // Direct hide on real post and fake review -> 204 No Content.
    const hidePostRes = await modApp!
      .http()
      .patch(
        `/api/admin/content/${ReportTargetType.POST}/${postDoc._id.toHexString()}/hide`,
      )
      .set('Cookie', admin.cookie);
    expect(hidePostRes.status).toBe(204);
    expect((await postModel.findById(postDoc._id).lean())?.isHidden).toBe(true);

    fakeEvents.clear();
    const hideReviewRes = await modApp!
      .http()
      .patch(`/api/admin/content/${ReportTargetType.REVIEW}/${reviewId}/hide`)
      .set('Cookie', admin.cookie);
    expect(hideReviewRes.status).toBe(204);
    expect(reviewsFake.isHidden(reviewId)).toBe(true);
    expect(
      (await reportModel.findById(openReviewReport._id).lean())?.status,
    ).toBe(ReportStatus.CONTENT_HIDDEN);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.CONTENT_HIDDEN,
        target: { type: ReportTargetType.REVIEW, id: reviewId },
        details: { closedReportCount: 1 },
      },
    ]);

    // Direct delete on real comment (decrements post commentCount) and fake itinerary -> 204 No Content.
    fakeEvents.clear();
    const delCommentRes = await modApp!
      .http()
      .delete(
        `/api/admin/content/${ReportTargetType.COMMENT}/${commentDoc._id.toHexString()}`,
      )
      .set('Cookie', admin.cookie);
    expect(delCommentRes.status).toBe(204);
    expect(await commentModel.findById(commentDoc._id).lean()).toBeNull();
    expect((await postModel.findById(postDoc._id).lean())?.commentCount).toBe(
      0,
    );

    fakeEvents.clear();
    const delItineraryRes = await modApp!
      .http()
      .delete(`/api/admin/content/${ReportTargetType.ITINERARY}/${itineraryId}`)
      .set('Cookie', admin.cookie);
    expect(delItineraryRes.status).toBe(204);
    expect(itinerariesFake.has(itineraryId)).toBe(false);
    expect(
      (await reportModel.findById(openItineraryReport._id).lean())?.status,
    ).toBe(ReportStatus.CONTENT_DELETED);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.CONTENT_DELETED,
        target: { type: ReportTargetType.ITINERARY, id: itineraryId },
        details: { closedReportCount: 1 },
      },
    ]);

    // 404 NOT_FOUND when target missing and 400 VALIDATION_FAILED for invalid type or ID.
    fakeEvents.clear();
    const missingHide = await modApp!
      .http()
      .patch(
        `/api/admin/content/${ReportTargetType.ITINERARY}/${itineraryId}/hide`,
      )
      .set('Cookie', admin.cookie);
    expect(missingHide.status).toBe(404);
    expect(missingHide.body.code).toBe(ErrorCode.NotFound);

    const missingDelete = await modApp!
      .http()
      .delete(`/api/admin/content/${ReportTargetType.ITINERARY}/${itineraryId}`)
      .set('Cookie', admin.cookie);
    expect(missingDelete.status).toBe(404);
    expect(missingDelete.body.code).toBe(ErrorCode.NotFound);

    const badType = await modApp!
      .http()
      .patch(
        `/api/admin/content/flight/${new Types.ObjectId().toHexString()}/hide`,
      )
      .set('Cookie', admin.cookie);
    expect(badType.status).toBe(400);
    expect(badType.body.code).toBe(ErrorCode.ValidationFailed);

    const badId = await modApp!
      .http()
      .delete(`/api/admin/content/${ReportTargetType.POST}/not-an-id`)
      .set('Cookie', admin.cookie);
    expect(badId.status).toBe(400);
    expect(badId.body.code).toBe(ErrorCode.ValidationFailed);

    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);
  });
});

describe('Admin Account Endpoints API (ACC-07a, ACC-13, ACC-14, ACC-16)', () => {
  let accApp: TestApp | undefined;
  const fakeAccounts = new FakeAccountsService();
  const fakeFlights = new FakeFlightsService();
  const fakeHotels = new FakeHotelsService();
  const fakeEvents = new FakeEvents();

  const airline1Id = '6736f0b2c5a1b2c3d4e51001';
  const inactiveHotelId = '6736f0b2c5a1b2c3d4e52001';
  const userActiveId = '6736f0b2c5a1b2c3d4e53001';
  const userSuspendedId = '6736f0b2c5a1b2c3d4e53002';
  const userDeactivatedId = '6736f0b2c5a1b2c3d4e53003';
  const modHotelId = '6736f0b2c5a1b2c3d4e53004';
  const adminAccountId = '6736f0b2c5a1b2c3d4e53005';
  const regexUserId = '6736f0b2c5a1b2c3d4e53006';

  function resetFakes(): void {
    const seededAccounts = new FakeAccountsService([
      {
        id: userActiveId,
        name: 'Aisha Al Rawahi',
        email: 'aisha@example.com',
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
      },
      {
        id: userSuspendedId,
        name: 'Omar Said',
        email: 'omar@example.com',
        role: UserRole.USER,
        status: UserStatus.SUSPENDED,
        createdAt: new Date('2026-11-02T10:00:00.000Z'),
      },
      {
        id: userDeactivatedId,
        name: 'Former Traveler',
        email: 'former@example.com',
        role: UserRole.USER,
        status: UserStatus.DEACTIVATED,
        createdAt: new Date('2026-11-03T10:00:00.000Z'),
      },
      {
        id: modHotelId,
        name: 'Nile Hotel Mod',
        email: 'mod@nile.example',
        role: UserRole.HOTEL_MODERATOR,
        status: UserStatus.ACTIVE,
        moderatorOf: {
          providerType: ProviderType.HOTEL,
          providerId: inactiveHotelId,
        },
        createdAt: new Date('2026-11-04T10:00:00.000Z'),
      },
      {
        id: adminAccountId,
        name: 'Platform Admin',
        email: 'admin@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        createdAt: new Date('2026-11-05T10:00:00.000Z'),
      },
      {
        id: regexUserId,
        name: 'vip+user (north).*',
        email: 'vip+tag@north.example',
        role: UserRole.AIRLINE_MODERATOR,
        status: UserStatus.SUSPENDED,
        moderatorOf: {
          providerType: ProviderType.AIRLINE,
          providerId: airline1Id,
        },
        createdAt: new Date('2026-11-06T10:00:00.000Z'),
      },
    ]);
    Object.assign(fakeAccounts, seededAccounts);

    const flightsData = new FakeFlightsData();
    flightsData.addAirline({ id: airline1Id, code: 'MS', name: 'EgyptAir' });
    Object.assign(fakeFlights, new FakeFlightsService(flightsData));

    const hotelsSeed = new FakeHotelsService({
      hotels: [
        {
          id: inactiveHotelId,
          name: 'Nile Hotel',
          address: '1 Nile St',
          cityId: 'cairo',
          countryCode: 'EG',
          photos: [],
          amenities: [],
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationPolicy: { tiers: [] },
          isActive: false,
          ratingSummary: { average: null, count: 0 },
        },
      ],
    });
    Object.assign(fakeHotels, hotelsSeed);

    fakeEvents.clear();
  }

  beforeAll(async () => {
    resetFakes();
    accApp = await createTestApp({
      imports: [AdminModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightBookingsService)
          .useValue(new FakeFlightBookingsService([]))
          .overrideProvider(HotelBookingsService)
          .useValue(new FakeHotelBookingsService([]))
          .overrideProvider(AccountsService)
          .useValue(fakeAccounts)
          .overrideProvider(FlightsService)
          .useValue(fakeFlights)
          .overrideProvider(HotelsService)
          .useValue(fakeHotels)
          .overrideProvider(AppEvents)
          .useValue(fakeEvents),
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCollections(accApp!.connection);
    resetFakes();
  });

  afterAll(async () => {
    await accApp?.close();
  }, HOOK_TIMEOUT);

  it('registers Swagger metadata for all ACC-07a, ACC-13, ACC-14, and ACC-16 admin routes', () => {
    const document = SwaggerModule.createDocument(
      accApp!.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );

    const accountsList = document.paths['/api/admin/accounts']?.get;
    expect(accountsList).toBeDefined();
    expect(accountsList?.tags).toContain('admin');
    expect(accountsList?.summary).toContain('ACC-14');
    expect(accountsList?.security).toBeDefined();
    expect(accountsList?.responses?.['200']).toBeDefined();

    const createMod = document.paths['/api/admin/moderators']?.post;
    expect(createMod).toBeDefined();
    expect(createMod?.tags).toContain('admin');
    expect(createMod?.summary).toContain('ACC-13');
    expect(createMod?.security).toBeDefined();
    expect(createMod?.responses?.['201']).toBeDefined();
    expect(createMod?.responses?.['404']).toBeDefined();
    expect(createMod?.responses?.['409']).toBeDefined();

    const resetPw =
      document.paths['/api/admin/users/{id}/reset-password']?.post;
    expect(resetPw).toBeDefined();
    expect(resetPw?.tags).toContain('admin');
    expect(resetPw?.summary).toContain('ACC-07a');
    expect(resetPw?.security).toBeDefined();
    expect(resetPw?.responses?.['204']).toBeDefined();

    const suspendOp = document.paths['/api/admin/accounts/{id}/suspend']?.patch;
    expect(suspendOp).toBeDefined();
    expect(suspendOp?.tags).toContain('admin');
    expect(suspendOp?.security).toBeDefined();
    expect(suspendOp?.responses?.['204']).toBeDefined();
    expect(suspendOp?.responses?.['409']).toBeDefined();

    const reactivateOp =
      document.paths['/api/admin/accounts/{id}/reactivate']?.patch;
    expect(reactivateOp).toBeDefined();
    expect(reactivateOp?.tags).toContain('admin');
    expect(reactivateOp?.security).toBeDefined();
    expect(reactivateOp?.responses?.['204']).toBeDefined();
    expect(reactivateOp?.responses?.['409']).toBeDefined();
  });

  it('rejects unauthenticated requests (401) and non-admin roles (403) across all five endpoints', async () => {
    const calls: (() => Promise<{
      status: number;
      body: { code?: string };
    }>)[] = [
      () => accApp!.http().get('/api/admin/accounts'),
      () =>
        accApp!.http().post('/api/admin/moderators').send({
          name: 'New Mod',
          email: 'newmod@airline.example',
          role: UserRole.AIRLINE_MODERATOR,
          providerId: airline1Id,
          temporaryPassword: 'Password1',
        }),
      () =>
        accApp!
          .http()
          .post(`/api/admin/users/${userActiveId}/reset-password`)
          .send({ temporaryPassword: 'Password1' }),
      () => accApp!.http().patch(`/api/admin/accounts/${userActiveId}/suspend`),
      () =>
        accApp!
          .http()
          .patch(`/api/admin/accounts/${userSuspendedId}/reactivate`),
    ];

    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
    }

    for (const role of [
      UserRole.USER,
      UserRole.AIRLINE_MODERATOR,
      UserRole.HOTEL_MODERATOR,
    ]) {
      const actor = await loginAs(accApp!.connection, role, {
        providerId: new Types.ObjectId().toHexString(),
      });

      const listRes = await accApp!
        .http()
        .get('/api/admin/accounts')
        .set('Cookie', actor.cookie);
      expect(listRes.status).toBe(403);
      expect(listRes.body.code).toBe(ErrorCode.ForbiddenRole);

      const modRes = await accApp!
        .http()
        .post('/api/admin/moderators')
        .set('Cookie', actor.cookie)
        .send({
          name: 'New Mod',
          email: 'newmod@airline.example',
          role: UserRole.AIRLINE_MODERATOR,
          providerId: airline1Id,
          temporaryPassword: 'Password1',
        });
      expect(modRes.status).toBe(403);
      expect(modRes.body.code).toBe(ErrorCode.ForbiddenRole);

      const resetRes = await accApp!
        .http()
        .post(`/api/admin/users/${userActiveId}/reset-password`)
        .set('Cookie', actor.cookie)
        .send({ temporaryPassword: 'Password1' });
      expect(resetRes.status).toBe(403);
      expect(resetRes.body.code).toBe(ErrorCode.ForbiddenRole);

      const suspendRes = await accApp!
        .http()
        .patch(`/api/admin/accounts/${userActiveId}/suspend`)
        .set('Cookie', actor.cookie);
      expect(suspendRes.status).toBe(403);
      expect(suspendRes.body.code).toBe(ErrorCode.ForbiddenRole);

      const reactivateRes = await accApp!
        .http()
        .patch(`/api/admin/accounts/${userSuspendedId}/reactivate`)
        .set('Cookie', actor.cookie);
      expect(reactivateRes.status).toBe(403);
      expect(reactivateRes.body.code).toBe(ErrorCode.ForbiddenRole);
    }

    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);
  });

  it('lists, searches (including literal regex chars), filters, and paginates accounts without leaking sensitive fields (ACC-14)', async () => {
    const admin = await loginAs(accApp!.connection, UserRole.ADMIN);

    const defaultRes = await accApp!
      .http()
      .get('/api/admin/accounts')
      .set('Cookie', admin.cookie);
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 6,
      totalPages: 1,
    });
    expect(
      defaultRes.body.items.map((item: { id: string }) => item.id),
    ).toEqual([
      regexUserId,
      adminAccountId,
      modHotelId,
      userDeactivatedId,
      userSuspendedId,
      userActiveId,
    ]);
    for (const item of defaultRes.body.items as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty('passwordHash');
      expect(item).not.toHaveProperty('temporaryPassword');
      expect(item).not.toHaveProperty('mustChangePassword');
      expect(item).not.toHaveProperty('sessionsRevoked');
    }
    const modRow = (defaultRes.body.items as Record<string, unknown>[]).find(
      (item) => item.id === modHotelId,
    );
    expect(Object.keys(modRow ?? {}).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'moderatorOf',
      'name',
      'role',
      'status',
    ]);
    const userRow = (defaultRes.body.items as Record<string, unknown>[]).find(
      (item) => item.id === userActiveId,
    );
    expect(Object.keys(userRow ?? {}).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'name',
      'role',
      'status',
    ]);

    // Pagination & boundaries
    const page2 = await accApp!
      .http()
      .get('/api/admin/accounts?page=2&limit=2')
      .set('Cookie', admin.cookie);
    expect(page2.status).toBe(200);
    expect(page2.body).toMatchObject({
      page: 2,
      limit: 2,
      total: 6,
      totalPages: 3,
    });
    expect(page2.body.items.map((item: { id: string }) => item.id)).toEqual([
      modHotelId,
      userDeactivatedId,
    ]);

    const maxLimit = await accApp!
      .http()
      .get('/api/admin/accounts?limit=50')
      .set('Cookie', admin.cookie);
    expect(maxLimit.status).toBe(200);
    expect(maxLimit.body.items).toHaveLength(6);

    const pastEnd = await accApp!
      .http()
      .get('/api/admin/accounts?page=4&limit=2')
      .set('Cookie', admin.cookie);
    expect(pastEnd.status).toBe(200);
    expect(pastEnd.body).toEqual({
      items: [],
      page: 4,
      limit: 2,
      total: 6,
      totalPages: 3,
    });

    // Search by name/email (case-insensitive & literal regex chars) + empty results
    const byName = await accApp!
      .http()
      .get('/api/admin/accounts?q=%20%20RAWAHI%20')
      .set('Cookie', admin.cookie);
    expect(byName.status).toBe(200);
    expect(byName.body.items.map((item: { id: string }) => item.id)).toEqual([
      userActiveId,
    ]);

    const byEmail = await accApp!
      .http()
      .get('/api/admin/accounts?q=OMAR%40EXAMPLE.COM')
      .set('Cookie', admin.cookie);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.items.map((item: { id: string }) => item.id)).toEqual([
      userSuspendedId,
    ]);

    const literalRegex = await accApp!
      .http()
      .get(`/api/admin/accounts?q=${encodeURIComponent('vip+user (north).*')}`)
      .set('Cookie', admin.cookie);
    expect(literalRegex.status).toBe(200);
    expect(
      literalRegex.body.items.map((item: { id: string }) => item.id),
    ).toEqual([regexUserId]);

    // Wildcard regex without matching literal characters returns 0 items.
    const regexWildcard = await accApp!
      .http()
      .get(`/api/admin/accounts?q=${encodeURIComponent('vip.*north')}`)
      .set('Cookie', admin.cookie);
    expect(regexWildcard.status).toBe(200);
    expect(regexWildcard.body.items).toEqual([]);

    // Role, status, and combined filters
    const byRole = await accApp!
      .http()
      .get(`/api/admin/accounts?role=${UserRole.HOTEL_MODERATOR}`)
      .set('Cookie', admin.cookie);
    expect(byRole.status).toBe(200);
    expect(byRole.body.items.map((item: { id: string }) => item.id)).toEqual([
      modHotelId,
    ]);

    const byStatus = await accApp!
      .http()
      .get(`/api/admin/accounts?status=${UserStatus.SUSPENDED}`)
      .set('Cookie', admin.cookie);
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.items.map((item: { id: string }) => item.id)).toEqual([
      regexUserId,
      userSuspendedId,
    ]);

    const combined = await accApp!
      .http()
      .get(
        `/api/admin/accounts?q=north&role=${UserRole.AIRLINE_MODERATOR}&status=${UserStatus.SUSPENDED}`,
      )
      .set('Cookie', admin.cookie);
    expect(combined.status).toBe(200);
    expect(combined.body.items.map((item: { id: string }) => item.id)).toEqual([
      regexUserId,
    ]);

    // Invalid queries -> 400 VALIDATION_FAILED
    for (const badQuery of [
      'role=superadmin',
      'status=archived',
      'limit=51',
      'limit=0',
      'page=0',
      'unknown=1',
    ]) {
      const invalidRes = await accApp!
        .http()
        .get(`/api/admin/accounts?${badQuery}`)
        .set('Cookie', admin.cookie);
      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.code).toBe(ErrorCode.ValidationFailed);
    }

    // Listing never emits audit events
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);
  });

  it('creates airline and hotel moderators after verifying providers, rejects missing/wrong providers and invalid/duplicate inputs (ACC-13)', async () => {
    const admin = await loginAs(accApp!.connection, UserRole.ADMIN);
    const getAirlineSpy = vi.spyOn(fakeFlights, 'getAirline');
    const getHotelSpy = vi.spyOn(fakeHotels, 'getHotel');
    const createModSpy = vi.spyOn(fakeAccounts, 'createModerator');

    // 1) Create airline_moderator
    const airlineModRes = await accApp!
      .http()
      .post('/api/admin/moderators')
      .set('Cookie', admin.cookie)
      .send({
        name: '  EgyptAir Mod  ',
        email: 'Airline.Mod@Example.COM',
        role: UserRole.AIRLINE_MODERATOR,
        providerId: airline1Id,
        temporaryPassword: 'TempPass1',
      });
    expect(airlineModRes.status).toBe(201);
    expect(
      Object.keys(airlineModRes.body as Record<string, unknown>).sort(),
    ).toEqual([
      'createdAt',
      'email',
      'id',
      'moderatorOf',
      'name',
      'role',
      'status',
    ]);
    expect(airlineModRes.body).toMatchObject({
      name: 'EgyptAir Mod',
      email: 'airline.mod@example.com',
      role: UserRole.AIRLINE_MODERATOR,
      status: UserStatus.ACTIVE,
      moderatorOf: {
        providerType: ProviderType.AIRLINE,
        providerId: airline1Id,
      },
    });
    expect(airlineModRes.body).not.toHaveProperty('temporaryPassword');
    expect(airlineModRes.body).not.toHaveProperty('passwordHash');
    expect(airlineModRes.body).not.toHaveProperty('mustChangePassword');
    expect(getAirlineSpy).toHaveBeenCalledWith(airline1Id);
    expect(getHotelSpy).not.toHaveBeenCalled();

    const storedAirlineMod = fakeAccounts.get(airlineModRes.body.id as string);
    expect(storedAirlineMod).toMatchObject({
      mustChangePassword: true,
      temporaryPassword: 'TempPass1',
      moderatorOf: {
        providerType: ProviderType.AIRLINE,
        providerId: airline1Id,
      },
    });

    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.MODERATOR_CREATED,
        target: { type: 'user', id: airlineModRes.body.id },
        details: {
          role: UserRole.AIRLINE_MODERATOR,
          providerType: ProviderType.AIRLINE,
          providerId: airline1Id,
        },
      },
    ]);

    // 2) Create second hotel_moderator even for an inactive hotel that already has another moderator
    fakeEvents.clear();
    getAirlineSpy.mockClear();
    getHotelSpy.mockClear();
    const hotelModRes = await accApp!
      .http()
      .post('/api/admin/moderators')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Second Nile Mod',
        email: 'second.mod@nile.example',
        role: UserRole.HOTEL_MODERATOR,
        providerId: inactiveHotelId,
        temporaryPassword: 'HotelPass9',
      });
    expect(hotelModRes.status).toBe(201);
    expect(hotelModRes.body.moderatorOf).toEqual({
      providerType: ProviderType.HOTEL,
      providerId: inactiveHotelId,
    });
    expect(getHotelSpy).toHaveBeenCalledWith(inactiveHotelId);
    expect(getAirlineSpy).not.toHaveBeenCalled();
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(1);
    expect(fakeEvents.payloadsOf(Events.AdminAction)[0]).toEqual({
      actorId: admin.id,
      action: AuditAction.MODERATOR_CREATED,
      target: { type: 'user', id: hotelModRes.body.id },
      details: {
        role: UserRole.HOTEL_MODERATOR,
        providerType: ProviderType.HOTEL,
        providerId: inactiveHotelId,
      },
    });

    // 3) Missing or wrong-type providers -> 404 NOT_FOUND without calling createModerator or emitting events
    fakeEvents.clear();
    createModSpy.mockClear();
    const unknownId = new Types.ObjectId().toHexString();
    for (const [role, providerId] of [
      [UserRole.AIRLINE_MODERATOR, unknownId],
      [UserRole.HOTEL_MODERATOR, unknownId],
      [UserRole.AIRLINE_MODERATOR, inactiveHotelId],
      [UserRole.HOTEL_MODERATOR, airline1Id],
    ] as const) {
      const notFoundRes = await accApp!
        .http()
        .post('/api/admin/moderators')
        .set('Cookie', admin.cookie)
        .send({
          name: 'Orphan Mod',
          email: `orphan.${providerId}@example.com`,
          role,
          providerId,
          temporaryPassword: 'TempPass1',
        });
      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.code).toBe(ErrorCode.NotFound);
    }
    expect(createModSpy).not.toHaveBeenCalled();
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);

    // 4) Duplicate email -> 409 EMAIL_TAKEN, no audit event
    const duplicateRes = await accApp!
      .http()
      .post('/api/admin/moderators')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Duplicate',
        email: 'AISHA@EXAMPLE.COM',
        role: UserRole.HOTEL_MODERATOR,
        providerId: inactiveHotelId,
        temporaryPassword: 'TempPass1',
      });
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.code).toBe(ErrorCode.EmailTaken);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);

    // 5) Validation errors -> 400 VALIDATION_FAILED, no audit event
    const invalidPayloads: Record<string, unknown>[] = [
      {},
      {
        name: '   ',
        email: 'valid@example.com',
        role: UserRole.AIRLINE_MODERATOR,
        providerId: airline1Id,
        temporaryPassword: 'TempPass1',
      },
      {
        name: 'Bad Email',
        email: 'not-an-email',
        role: UserRole.AIRLINE_MODERATOR,
        providerId: airline1Id,
        temporaryPassword: 'TempPass1',
      },
      {
        name: 'Wrong Role User',
        email: 'u@example.com',
        role: UserRole.USER,
        providerId: airline1Id,
        temporaryPassword: 'TempPass1',
      },
      {
        name: 'Wrong Role Admin',
        email: 'adm@example.com',
        role: UserRole.ADMIN,
        providerId: airline1Id,
        temporaryPassword: 'TempPass1',
      },
      {
        name: 'Bad Provider ID',
        email: 'badid@example.com',
        role: UserRole.AIRLINE_MODERATOR,
        providerId: 'not-an-object-id',
        temporaryPassword: 'TempPass1',
      },
      {
        name: 'Short PW',
        email: 'shortpw@example.com',
        role: UserRole.AIRLINE_MODERATOR,
        providerId: airline1Id,
        temporaryPassword: 'Pass1',
      },
      {
        name: 'No Digit PW',
        email: 'nodigit@example.com',
        role: UserRole.AIRLINE_MODERATOR,
        providerId: airline1Id,
        temporaryPassword: 'PasswordOnly',
      },
      {
        name: 'No Letter PW',
        email: 'noletter@example.com',
        role: UserRole.AIRLINE_MODERATOR,
        providerId: airline1Id,
        temporaryPassword: '12345678',
      },
      {
        name: 'Extra Field',
        email: 'extra@example.com',
        role: UserRole.AIRLINE_MODERATOR,
        providerId: airline1Id,
        temporaryPassword: 'TempPass1',
        mustChangePassword: false,
      },
    ];
    createModSpy.mockClear();
    for (const payload of invalidPayloads) {
      const res = await accApp!
        .http()
        .post('/api/admin/moderators')
        .set('Cookie', admin.cookie)
        .send(payload);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.ValidationFailed);
    }
    expect(createModSpy).not.toHaveBeenCalled();
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);
  });

  it('resets temporary password (204), updates fake state and sessions, emits clean audit event, and rejects invalid inputs (ACC-07a)', async () => {
    const admin = await loginAs(accApp!.connection, UserRole.ADMIN);

    const resetUserRes = await accApp!
      .http()
      .post(`/api/admin/users/${userActiveId}/reset-password`)
      .set('Cookie', admin.cookie)
      .send({ temporaryPassword: 'NewTemp99' });
    expect(resetUserRes.status).toBe(204);
    expect(resetUserRes.text).toBe('');

    expect(fakeAccounts.get(userActiveId)).toMatchObject({
      mustChangePassword: true,
      temporaryPassword: 'NewTemp99',
      sessionsRevoked: 1,
    });

    const resetModRes = await accApp!
      .http()
      .post(`/api/admin/users/${modHotelId}/reset-password`)
      .set('Cookie', admin.cookie)
      .send({ temporaryPassword: 'ModTemp88' });
    expect(resetModRes.status).toBe(204);
    expect(fakeAccounts.get(modHotelId)).toMatchObject({
      mustChangePassword: true,
      temporaryPassword: 'ModTemp88',
      sessionsRevoked: 1,
    });

    const resetEvents = fakeEvents.payloadsOf(Events.AdminAction);
    expect(resetEvents).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.PASSWORD_RESET,
        target: { type: 'user', id: userActiveId },
      },
      {
        actorId: admin.id,
        action: AuditAction.PASSWORD_RESET,
        target: { type: 'user', id: modHotelId },
      },
    ]);
    expect(JSON.stringify(resetEvents)).not.toContain('NewTemp99');
    expect(JSON.stringify(resetEvents)).not.toContain('ModTemp88');

    fakeEvents.clear();
    const unknownRes = await accApp!
      .http()
      .post(
        `/api/admin/users/${new Types.ObjectId().toHexString()}/reset-password`,
      )
      .set('Cookie', admin.cookie)
      .send({ temporaryPassword: 'NewTemp99' });
    expect(unknownRes.status).toBe(404);
    expect(unknownRes.body.code).toBe(ErrorCode.NotFound);

    const badIdRes = await accApp!
      .http()
      .post('/api/admin/users/not-an-id/reset-password')
      .set('Cookie', admin.cookie)
      .send({ temporaryPassword: 'NewTemp99' });
    expect(badIdRes.status).toBe(400);
    expect(badIdRes.body.code).toBe(ErrorCode.ValidationFailed);

    for (const badBody of [
      {},
      { temporaryPassword: 'short1a' },
      { temporaryPassword: 'NoDigitsHere' },
      { temporaryPassword: '12345678' },
      { temporaryPassword: 'ValidPass1', extraField: true },
    ]) {
      const badPwRes = await accApp!
        .http()
        .post(`/api/admin/users/${userActiveId}/reset-password`)
        .set('Cookie', admin.cookie)
        .send(badBody);
      expect(badPwRes.status).toBe(400);
      expect(badPwRes.body.code).toBe(ErrorCode.ValidationFailed);
    }

    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);
  });

  it('suspends and reactivates user and moderator accounts (204), rejects invalid transitions (409) and deactivated reactivation (ACC-15, ACC-16)', async () => {
    const admin = await loginAs(accApp!.connection, UserRole.ADMIN);

    // 1) Suspend active user -> 204, status=suspended, sessionsRevoked incremented
    const suspendUserRes = await accApp!
      .http()
      .patch(`/api/admin/accounts/${userActiveId}/suspend`)
      .set('Cookie', admin.cookie);
    expect(suspendUserRes.status).toBe(204);
    expect(suspendUserRes.text).toBe('');
    expect(fakeAccounts.get(userActiveId)).toMatchObject({
      status: UserStatus.SUSPENDED,
      sessionsRevoked: 1,
    });

    // 2) Reactivate suspended user -> 204, status=active
    const reactivateUserRes = await accApp!
      .http()
      .patch(`/api/admin/accounts/${userActiveId}/reactivate`)
      .set('Cookie', admin.cookie);
    expect(reactivateUserRes.status).toBe(204);
    expect(reactivateUserRes.text).toBe('');
    expect(fakeAccounts.get(userActiveId)?.status).toBe(UserStatus.ACTIVE);

    // 3) Suspend & reactivate moderator account too
    const suspendModRes = await accApp!
      .http()
      .patch(`/api/admin/accounts/${modHotelId}/suspend`)
      .set('Cookie', admin.cookie);
    expect(suspendModRes.status).toBe(204);
    expect(fakeAccounts.get(modHotelId)).toMatchObject({
      status: UserStatus.SUSPENDED,
      sessionsRevoked: 1,
    });

    const reactivateModRes = await accApp!
      .http()
      .patch(`/api/admin/accounts/${modHotelId}/reactivate`)
      .set('Cookie', admin.cookie);
    expect(reactivateModRes.status).toBe(204);
    expect(fakeAccounts.get(modHotelId)?.status).toBe(UserStatus.ACTIVE);

    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.ACCOUNT_SUSPENDED,
        target: { type: 'user', id: userActiveId },
      },
      {
        actorId: admin.id,
        action: AuditAction.ACCOUNT_REACTIVATED,
        target: { type: 'user', id: userActiveId },
      },
      {
        actorId: admin.id,
        action: AuditAction.ACCOUNT_SUSPENDED,
        target: { type: 'user', id: modHotelId },
      },
      {
        actorId: admin.id,
        action: AuditAction.ACCOUNT_REACTIVATED,
        target: { type: 'user', id: modHotelId },
      },
    ]);
    // Admin must not duplicate account.suspended / account.reactivated owned by accounts.
    expect(fakeEvents.payloadsOf(Events.AccountSuspended)).toHaveLength(0);
    expect(fakeEvents.payloadsOf(Events.AccountReactivated)).toHaveLength(0);

    // 4) Invalid status transitions (409 INVALID_STATUS_TRANSITION) including deactivated account
    fakeEvents.clear();
    const suspendAlreadySuspended = await accApp!
      .http()
      .patch(`/api/admin/accounts/${userSuspendedId}/suspend`)
      .set('Cookie', admin.cookie);
    expect(suspendAlreadySuspended.status).toBe(409);
    expect(suspendAlreadySuspended.body.code).toBe(
      ErrorCode.InvalidStatusTransition,
    );

    const reactivateAlreadyActive = await accApp!
      .http()
      .patch(`/api/admin/accounts/${userActiveId}/reactivate`)
      .set('Cookie', admin.cookie);
    expect(reactivateAlreadyActive.status).toBe(409);
    expect(reactivateAlreadyActive.body.code).toBe(
      ErrorCode.InvalidStatusTransition,
    );

    const suspendDeactivated = await accApp!
      .http()
      .patch(`/api/admin/accounts/${userDeactivatedId}/suspend`)
      .set('Cookie', admin.cookie);
    expect(suspendDeactivated.status).toBe(409);
    expect(suspendDeactivated.body.code).toBe(
      ErrorCode.InvalidStatusTransition,
    );

    const reactivateDeactivated = await accApp!
      .http()
      .patch(`/api/admin/accounts/${userDeactivatedId}/reactivate`)
      .set('Cookie', admin.cookie);
    expect(reactivateDeactivated.status).toBe(409);
    expect(reactivateDeactivated.body.code).toBe(
      ErrorCode.InvalidStatusTransition,
    );
    expect(fakeAccounts.get(userDeactivatedId)?.status).toBe(
      UserStatus.DEACTIVATED,
    );

    // 5) Missing account -> 404, malformed id -> 400
    const missingId = new Types.ObjectId().toHexString();
    expect(
      (
        await accApp!
          .http()
          .patch(`/api/admin/accounts/${missingId}/suspend`)
          .set('Cookie', admin.cookie)
      ).status,
    ).toBe(404);
    expect(
      (
        await accApp!
          .http()
          .patch(`/api/admin/accounts/${missingId}/reactivate`)
          .set('Cookie', admin.cookie)
      ).status,
    ).toBe(404);
    expect(
      (
        await accApp!
          .http()
          .patch('/api/admin/accounts/not-an-id/suspend')
          .set('Cookie', admin.cookie)
      ).status,
    ).toBe(400);
    expect(
      (
        await accApp!
          .http()
          .patch('/api/admin/accounts/not-an-id/reactivate')
          .set('Cookie', admin.cookie)
      ).status,
    ).toBe(400);

    expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);
  });
});

describe('Admin Provider Deactivation API (ACC-15)', () => {
  let accApp: TestApp | undefined;
  const fakeAccounts = new FakeAccountsService();
  const fakeFlights = new FakeFlightsService();
  const fakeHotels = new FakeHotelsService();
  const fakeFlightBookings = new FakeFlightBookingsService();
  const fakeHotelBookings = new FakeHotelBookingsService();
  const fakeEvents = new FakeEvents();

  const airline1Id = '6736f0b2c5a1b2c3d4e54101';
  const airline2Id = '6736f0b2c5a1b2c3d4e54102';
  const hotel1Id = '6736f0b2c5a1b2c3d4e54201';
  const hotel2Id = '6736f0b2c5a1b2c3d4e54202';

  const modAirlineActiveId = '6736f0b2c5a1b2c3d4e54301';
  const modAirlineSuspendedId = '6736f0b2c5a1b2c3d4e54302';
  const modHotelActiveId = '6736f0b2c5a1b2c3d4e54303';
  const modHotelDeactivatedId = '6736f0b2c5a1b2c3d4e54304';

  function resetFakes(): void {
    Object.assign(
      fakeAccounts,
      new FakeAccountsService([
        {
          id: modAirlineActiveId,
          name: 'Airline Active Mod',
          email: 'airline-active@example.com',
          role: UserRole.AIRLINE_MODERATOR,
          status: UserStatus.ACTIVE,
          moderatorOf: {
            providerType: ProviderType.AIRLINE,
            providerId: airline1Id,
          },
        },
        {
          id: modAirlineSuspendedId,
          name: 'Airline Suspended Mod',
          email: 'airline-suspended@example.com',
          role: UserRole.AIRLINE_MODERATOR,
          status: UserStatus.SUSPENDED,
          moderatorOf: {
            providerType: ProviderType.AIRLINE,
            providerId: airline1Id,
          },
        },
        {
          id: modHotelActiveId,
          name: 'Hotel Active Mod',
          email: 'hotel-active@example.com',
          role: UserRole.HOTEL_MODERATOR,
          status: UserStatus.ACTIVE,
          moderatorOf: {
            providerType: ProviderType.HOTEL,
            providerId: hotel1Id,
          },
        },
        {
          id: modHotelDeactivatedId,
          name: 'Hotel Deactivated Mod',
          email: 'hotel-deactivated@example.com',
          role: UserRole.HOTEL_MODERATOR,
          status: UserStatus.DEACTIVATED,
          moderatorOf: {
            providerType: ProviderType.HOTEL,
            providerId: hotel1Id,
          },
        },
      ]),
    );

    const flightsData = new FakeFlightsData();
    flightsData.addAirline({
      id: airline1Id,
      code: 'MS',
      name: 'EgyptAir',
      isActive: true,
    });
    flightsData.addAirline({
      id: airline2Id,
      code: 'RJ',
      name: 'Royal Jordanian',
      isActive: false,
    });
    Object.assign(fakeFlights, new FakeFlightsService(flightsData));

    Object.assign(
      fakeHotels,
      new FakeHotelsService({
        hotels: [
          {
            id: hotel1Id,
            name: 'Nile Hotel',
            address: '1 Nile St',
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
          {
            id: hotel2Id,
            name: 'Oasis Inn',
            address: '2 Oasis Rd',
            cityId: 'luxor',
            countryCode: 'EG',
            photos: [],
            amenities: [],
            checkInTime: '14:00',
            checkOutTime: '12:00',
            cancellationPolicy: { tiers: [] },
            isActive: false,
            ratingSummary: { average: null, count: 0 },
          },
        ],
      }),
    );

    Object.assign(
      fakeFlightBookings,
      new FakeFlightBookingsService([
        { ...FLIGHT_SEED[0], providerId: airline1Id },
      ]),
    );
    Object.assign(
      fakeHotelBookings,
      new FakeHotelBookingsService([
        { ...HOTEL_SEED[0], providerId: hotel1Id },
      ]),
    );
    fakeEvents.clear();
  }

  beforeAll(async () => {
    resetFakes();
    accApp = await createTestApp({
      imports: [AdminModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightBookingsService)
          .useValue(fakeFlightBookings)
          .overrideProvider(HotelBookingsService)
          .useValue(fakeHotelBookings)
          .overrideProvider(AccountsService)
          .useValue(fakeAccounts)
          .overrideProvider(FlightsService)
          .useValue(fakeFlights)
          .overrideProvider(HotelsService)
          .useValue(fakeHotels)
          .overrideProvider(AppEvents)
          .useValue(fakeEvents),
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(accApp!.connection);
    resetFakes();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await accApp?.close();
  }, HOOK_TIMEOUT);

  it('registers Swagger metadata for ACC-15 provider deactivation and reactivation routes', () => {
    const doc = SwaggerModule.createDocument(
      accApp!.app,
      new DocumentBuilder()
        .setTitle('Travel Platform')
        .setVersion('1.0')
        .addCookieAuth()
        .build(),
    );

    expect(doc.paths['/api/admin/bookings']?.get?.summary).toContain('ACC-17');

    for (const [pathKey, keyword] of [
      ['/api/admin/providers/{type}/{id}/deactivate', 'Deactivate'],
      ['/api/admin/providers/{type}/{id}/reactivate', 'Reactivate'],
    ] as const) {
      const op = doc.paths[pathKey]?.patch;
      expect(op).toBeDefined();
      expect(op?.tags).toContain('admin');
      expect(op?.summary).toContain('ACC-15');
      expect(op?.summary).toContain(keyword);
      expect(op?.security?.length ?? 0).toBeGreaterThan(0);

      const params = (op?.parameters ?? []) as {
        name: string;
        in: string;
        schema?: { enum?: unknown[]; type?: string };
      }[];
      const typeParam = params.find(
        (param) => param.name === 'type' && param.in === 'path',
      );
      const idParam = params.find(
        (param) => param.name === 'id' && param.in === 'path',
      );
      expect(typeParam?.schema?.enum).toEqual(['airline', 'hotel']);
      expect(idParam?.schema?.type).toBe('string');

      const responses = op?.responses ?? {};
      expect(responses['204']).toBeDefined();
      expect(responses['400']).toBeDefined();
      expect(responses['401']).toBeDefined();
      expect(responses['403']).toBeDefined();
      expect(responses['404']).toBeDefined();
    }
  });

  it('rejects unauthenticated requests (401) and non-admin roles (403) without mutating providers or emitting events', async () => {
    const getModsSpy = vi.spyOn(fakeAccounts, 'getModeratorIds');
    const setAirlineSpy = vi.spyOn(fakeFlights, 'setAirlineActive');
    const setHotelSpy = vi.spyOn(fakeHotels, 'setActive');

    const paths = [
      `/api/admin/providers/airline/${airline1Id}/deactivate`,
      `/api/admin/providers/airline/${airline2Id}/reactivate`,
      `/api/admin/providers/hotel/${hotel1Id}/deactivate`,
      `/api/admin/providers/hotel/${hotel2Id}/reactivate`,
    ];

    for (const path of paths) {
      const res = await accApp!.http().patch(path);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
    }

    const actors = [
      await loginAs(accApp!.connection, UserRole.USER),
      await loginAs(accApp!.connection, UserRole.AIRLINE_MODERATOR, {
        providerId: airline1Id,
      }),
      await loginAs(accApp!.connection, UserRole.HOTEL_MODERATOR, {
        providerId: hotel1Id,
      }),
    ];

    for (const actor of actors) {
      for (const path of paths) {
        const res = await accApp!
          .http()
          .patch(path)
          .set('Cookie', actor.cookie);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe(ErrorCode.ForbiddenRole);
      }
    }

    expect(getModsSpy).not.toHaveBeenCalled();
    expect(setAirlineSpy).not.toHaveBeenCalled();
    expect(setHotelSpy).not.toHaveBeenCalled();
    expect((await fakeFlights.getAirline(airline1Id))?.isActive).toBe(true);
    expect((await fakeFlights.getAirline(airline2Id))?.isActive).toBe(false);
    expect((await fakeHotels.getHotel(hotel1Id))?.isActive).toBe(true);
    expect((await fakeHotels.getHotel(hotel2Id))?.isActive).toBe(false);
    expect(fakeEvents.emitted).toHaveLength(0);
  });

  it('deactivates and reactivates airlines and hotels (204), notifies all moderators (including empty lists), repeats safely, and leaves accounts/bookings untouched', async () => {
    const admin = await loginAs(accApp!.connection, UserRole.ADMIN);

    const getModsSpy = vi.spyOn(fakeAccounts, 'getModeratorIds');
    const suspendSpy = vi.spyOn(fakeAccounts, 'suspend');
    const reactivateAccountSpy = vi.spyOn(fakeAccounts, 'reactivate');
    const resetPwSpy = vi.spyOn(fakeAccounts, 'resetPassword');
    const setAirlineSpy = vi.spyOn(fakeFlights, 'setAirlineActive');
    const setHotelSpy = vi.spyOn(fakeHotels, 'setActive');
    const listFlightBookingsSpy = vi.spyOn(fakeFlightBookings, 'listForAdmin');
    const listHotelBookingsSpy = vi.spyOn(fakeHotelBookings, 'listForAdmin');

    // 1) Deactivate active airline (and verify endpoint ignores client-sent body isActive=true)
    const deactAirline = await accApp!
      .http()
      .patch(`/api/admin/providers/airline/${airline1Id}/deactivate`)
      .set('Cookie', admin.cookie)
      .send({ isActive: true });
    expect(deactAirline.status).toBe(204);
    expect(deactAirline.text).toBe('');
    expect(getModsSpy).toHaveBeenCalledWith(ProviderType.AIRLINE, airline1Id);
    expect(setAirlineSpy).toHaveBeenCalledWith(airline1Id, false);
    expect(setHotelSpy).not.toHaveBeenCalled();
    expect((await fakeFlights.getAirline(airline1Id))?.isActive).toBe(false);
    expect(fakeEvents.payloadsOf(Events.ProviderDeactivated)).toEqual([
      {
        providerType: ProviderType.AIRLINE,
        providerId: airline1Id,
        moderatorIds: [modAirlineActiveId, modAirlineSuspendedId],
      },
    ]);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.PROVIDER_DEACTIVATED,
        target: { type: ProviderType.AIRLINE, id: airline1Id },
      },
    ]);

    // 2) Repeated deactivate keeps isActive=false and emits one event pair.
    fakeEvents.clear();
    const repeatDeactAirline = await accApp!
      .http()
      .patch(`/api/admin/providers/airline/${airline1Id}/deactivate`)
      .set('Cookie', admin.cookie);
    expect(repeatDeactAirline.status).toBe(204);
    expect((await fakeFlights.getAirline(airline1Id))?.isActive).toBe(false);
    expect(fakeEvents.payloadsOf(Events.ProviderDeactivated)).toHaveLength(1);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.PROVIDER_DEACTIVATED,
        target: { type: ProviderType.AIRLINE, id: airline1Id },
      },
    ]);

    // 3) Reactivate airline (and verify endpoint ignores client-sent body isActive=false)
    fakeEvents.clear();
    const reactAirline = await accApp!
      .http()
      .patch(`/api/admin/providers/airline/${airline1Id}/reactivate`)
      .set('Cookie', admin.cookie)
      .send({ isActive: false });
    expect(reactAirline.status).toBe(204);
    expect(reactAirline.text).toBe('');
    expect(setAirlineSpy).toHaveBeenLastCalledWith(airline1Id, true);
    expect((await fakeFlights.getAirline(airline1Id))?.isActive).toBe(true);
    expect(fakeEvents.payloadsOf(Events.ProviderReactivated)).toEqual([
      {
        providerType: ProviderType.AIRLINE,
        providerId: airline1Id,
        moderatorIds: [modAirlineActiveId, modAirlineSuspendedId],
      },
    ]);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.PROVIDER_REACTIVATED,
        target: { type: ProviderType.AIRLINE, id: airline1Id },
      },
    ]);

    // 4) Airline with zero moderators succeeds with moderatorIds: []
    fakeEvents.clear();
    const reactAirlineNoMods = await accApp!
      .http()
      .patch(`/api/admin/providers/airline/${airline2Id}/reactivate`)
      .set('Cookie', admin.cookie);
    expect(reactAirlineNoMods.status).toBe(204);
    expect((await fakeFlights.getAirline(airline2Id))?.isActive).toBe(true);
    expect(fakeEvents.payloadsOf(Events.ProviderReactivated)).toEqual([
      {
        providerType: ProviderType.AIRLINE,
        providerId: airline2Id,
        moderatorIds: [],
      },
    ]);

    // 5) Hotel deactivate and repeated deactivate isolate FlightsService
    fakeEvents.clear();
    setAirlineSpy.mockClear();
    const deactHotel = await accApp!
      .http()
      .patch(`/api/admin/providers/hotel/${hotel1Id}/deactivate`)
      .set('Cookie', admin.cookie);
    expect(deactHotel.status).toBe(204);
    expect(deactHotel.text).toBe('');
    expect(getModsSpy).toHaveBeenCalledWith(ProviderType.HOTEL, hotel1Id);
    expect(setHotelSpy).toHaveBeenCalledWith(hotel1Id, false);
    expect(setAirlineSpy).not.toHaveBeenCalled();
    expect((await fakeHotels.getHotel(hotel1Id))?.isActive).toBe(false);
    expect(fakeEvents.payloadsOf(Events.ProviderDeactivated)).toEqual([
      {
        providerType: ProviderType.HOTEL,
        providerId: hotel1Id,
        moderatorIds: [modHotelActiveId, modHotelDeactivatedId],
      },
    ]);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.PROVIDER_DEACTIVATED,
        target: { type: ProviderType.HOTEL, id: hotel1Id },
      },
    ]);

    // 6) Hotel reactivate + zero-moderator hotel + repeated reactivate
    fakeEvents.clear();
    const reactHotel = await accApp!
      .http()
      .patch(`/api/admin/providers/hotel/${hotel1Id}/reactivate`)
      .set('Cookie', admin.cookie);
    expect(reactHotel.status).toBe(204);
    expect((await fakeHotels.getHotel(hotel1Id))?.isActive).toBe(true);
    expect(fakeEvents.payloadsOf(Events.ProviderReactivated)).toEqual([
      {
        providerType: ProviderType.HOTEL,
        providerId: hotel1Id,
        moderatorIds: [modHotelActiveId, modHotelDeactivatedId],
      },
    ]);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: admin.id,
        action: AuditAction.PROVIDER_REACTIVATED,
        target: { type: ProviderType.HOTEL, id: hotel1Id },
      },
    ]);

    fakeEvents.clear();
    const reactHotelNoMods = await accApp!
      .http()
      .patch(`/api/admin/providers/hotel/${hotel2Id}/reactivate`)
      .set('Cookie', admin.cookie);
    expect(reactHotelNoMods.status).toBe(204);
    expect((await fakeHotels.getHotel(hotel2Id))?.isActive).toBe(true);

    const repeatReactHotel = await accApp!
      .http()
      .patch(`/api/admin/providers/hotel/${hotel2Id}/reactivate`)
      .set('Cookie', admin.cookie);
    expect(repeatReactHotel.status).toBe(204);
    expect((await fakeHotels.getHotel(hotel2Id))?.isActive).toBe(true);
    expect(fakeEvents.payloadsOf(Events.ProviderReactivated)).toHaveLength(2);

    // 7) Verify moderators' account statuses, account events, and bookings remained untouched
    expect(suspendSpy).not.toHaveBeenCalled();
    expect(reactivateAccountSpy).not.toHaveBeenCalled();
    expect(resetPwSpy).not.toHaveBeenCalled();
    expect(listFlightBookingsSpy).not.toHaveBeenCalled();
    expect(listHotelBookingsSpy).not.toHaveBeenCalled();
    expect(fakeEvents.payloadsOf(Events.AccountSuspended)).toHaveLength(0);
    expect(fakeEvents.payloadsOf(Events.AccountReactivated)).toHaveLength(0);
    expect(fakeAccounts.get(modAirlineActiveId)?.status).toBe(
      UserStatus.ACTIVE,
    );
    expect(fakeAccounts.get(modAirlineSuspendedId)?.status).toBe(
      UserStatus.SUSPENDED,
    );
    expect(fakeAccounts.get(modHotelDeactivatedId)?.status).toBe(
      UserStatus.DEACTIVATED,
    );
    expect(fakeFlightBookings.bookings).toHaveLength(1);
    expect(fakeHotelBookings.bookings).toHaveLength(1);
  });

  it('rejects invalid provider types (400), malformed IDs (400), and missing or cross-type providers (404) without mutating or emitting events', async () => {
    const admin = await loginAs(accApp!.connection, UserRole.ADMIN);
    const getModsSpy = vi.spyOn(fakeAccounts, 'getModeratorIds');
    const setAirlineSpy = vi.spyOn(fakeFlights, 'setAirlineActive');
    const setHotelSpy = vi.spyOn(fakeHotels, 'setActive');

    for (const badType of ['flight', 'user', 'AIRLINE']) {
      for (const action of ['deactivate', 'reactivate'] as const) {
        const res = await accApp!
          .http()
          .patch(`/api/admin/providers/${badType}/${airline1Id}/${action}`)
          .set('Cookie', admin.cookie);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
        expect(
          res.body.details.map((detail: { field: string }) => detail.field),
        ).toContain('type');
      }
    }

    for (const badId of [
      'not-an-id',
      '6736f0b2c5a1b2c3d4e5410',
      '6736f0b2c5a1b2c3d4e54101a',
    ]) {
      for (const action of ['deactivate', 'reactivate'] as const) {
        const res = await accApp!
          .http()
          .patch(`/api/admin/providers/airline/${badId}/${action}`)
          .set('Cookie', admin.cookie);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
        expect(
          res.body.details.map((detail: { field: string }) => detail.field),
        ).toContain('id');
      }
    }

    expect(getModsSpy).not.toHaveBeenCalled();
    expect(setAirlineSpy).not.toHaveBeenCalled();
    expect(setHotelSpy).not.toHaveBeenCalled();

    const missingId = new Types.ObjectId().toHexString();
    const notFoundPaths = [
      `/api/admin/providers/airline/${missingId}/deactivate`,
      `/api/admin/providers/hotel/${missingId}/reactivate`,
      `/api/admin/providers/airline/${hotel1Id}/deactivate`,
      `/api/admin/providers/hotel/${airline1Id}/reactivate`,
    ];

    for (const path of notFoundPaths) {
      const res = await accApp!.http().patch(path).set('Cookie', admin.cookie);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ErrorCode.NotFound);
    }

    expect((await fakeFlights.getAirline(airline1Id))?.isActive).toBe(true);
    expect((await fakeHotels.getHotel(hotel1Id))?.isActive).toBe(true);
    expect(fakeEvents.emitted).toHaveLength(0);
  });

  it('emits no events and prevents provider mutation when recipient lookup or provider write fails', async () => {
    const admin = await loginAs(accApp!.connection, UserRole.ADMIN);
    const getModsSpy = vi.spyOn(fakeAccounts, 'getModeratorIds');
    const setAirlineSpy = vi.spyOn(fakeFlights, 'setAirlineActive');
    const setHotelSpy = vi.spyOn(fakeHotels, 'setActive');

    // Recipient lookup failure happens before provider mutation -> state untouched, 0 events
    getModsSpy.mockRejectedValueOnce(new Error('accounts service unavailable'));
    const lookupFailRes = await accApp!
      .http()
      .patch(`/api/admin/providers/airline/${airline1Id}/deactivate`)
      .set('Cookie', admin.cookie);
    expect(lookupFailRes.status).toBe(500);
    expect(setAirlineSpy).not.toHaveBeenCalled();
    expect((await fakeFlights.getAirline(airline1Id))?.isActive).toBe(true);
    expect(fakeEvents.emitted).toHaveLength(0);

    getModsSpy.mockRejectedValueOnce(new Error('accounts service unavailable'));
    const hotelLookupFailRes = await accApp!
      .http()
      .patch(`/api/admin/providers/hotel/${hotel2Id}/reactivate`)
      .set('Cookie', admin.cookie);
    expect(hotelLookupFailRes.status).toBe(500);
    expect(setHotelSpy).not.toHaveBeenCalled();
    expect((await fakeHotels.getHotel(hotel2Id))?.isActive).toBe(false);
    expect(fakeEvents.emitted).toHaveLength(0);

    // Provider write failure -> lookup ran first, state unchanged, 0 events emitted
    setAirlineSpy.mockRejectedValueOnce(new Error('flights write failed'));
    const airlineWriteFailRes = await accApp!
      .http()
      .patch(`/api/admin/providers/airline/${airline1Id}/deactivate`)
      .set('Cookie', admin.cookie);
    expect(airlineWriteFailRes.status).toBe(500);
    expect(getModsSpy).toHaveBeenLastCalledWith(
      ProviderType.AIRLINE,
      airline1Id,
    );
    expect((await fakeFlights.getAirline(airline1Id))?.isActive).toBe(true);
    expect(fakeEvents.emitted).toHaveLength(0);

    setHotelSpy.mockRejectedValueOnce(new Error('hotels write failed'));
    const hotelWriteFailRes = await accApp!
      .http()
      .patch(`/api/admin/providers/hotel/${hotel1Id}/deactivate`)
      .set('Cookie', admin.cookie);
    expect(hotelWriteFailRes.status).toBe(500);
    expect(getModsSpy).toHaveBeenLastCalledWith(ProviderType.HOTEL, hotel1Id);
    expect((await fakeHotels.getHotel(hotel1Id))?.isActive).toBe(true);
    expect(fakeEvents.emitted).toHaveLength(0);
  });
});
