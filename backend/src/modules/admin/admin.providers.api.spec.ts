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
import { FakeAccountsService } from '../../../test/fakes/accounts.fake.js';
import type { FakeAccountSeed } from '../../../test/fakes/accounts.fake.js';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  ProviderType,
  UserRole,
  UserStatus,
} from '../accounts/schemas/user.schema.js';
import { FlightsService } from '../flights/flights.service.js';
import { HotelsService } from '../hotels/hotels.service.js';
import type { HotelView } from '../hotels/hotels.types.js';
import { AdminModule } from './admin.module.js';

const AIRLINE_KEYS = [
  '_id',
  'code',
  'moderatorCount',
  'name',
  'status',
  'type',
];
const HOTEL_KEYS = [
  '_id',
  'cityId',
  'countryCode',
  'moderatorCount',
  'name',
  'status',
  'type',
];

function makeId(hex: string): string {
  return hex.repeat(24).slice(0, 24);
}

const IDS = {
  a1: makeId('a1'),
  a2: makeId('a2'),
  a3: makeId('a3'),
  h1: makeId('b1'),
  h2: makeId('b2'),
  h3: makeId('b3'),
  h4: makeId('b4'),
  other: makeId('ff'),
};

function makeHotel(
  id: string,
  name: string,
  overrides: Partial<HotelView> = {},
): HotelView {
  return {
    id,
    name,
    address: '10 Secret Address',
    cityId: 'cairo',
    countryCode: 'EG',
    description: 'Private description that must not leak',
    photos: [{ id: 'p1', key: 'secret.jpg' }],
    starRating: 5,
    amenities: ['Pool'],
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationPolicy: { tiers: [{ daysBefore: 7, refundPercent: 100 }] },
    isActive: true,
    ratingSummary: { average: 4.8, count: 12 },
    ...overrides,
  };
}

function buildSeeds() {
  const flightsData = new FakeFlightsData();
  flightsData.addAirline({
    id: IDS.a1,
    code: 'MS',
    name: 'EgyptAir',
    isActive: true,
    baggagePolicy: { extraBagPriceMinor: 3000, maxExtraBagsPerPassenger: 2 },
    cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
  });
  flightsData.addAirline({
    id: IDS.a2,
    code: 'NL',
    name: 'Nile Air',
    isActive: false,
  });
  flightsData.addAirline({
    id: IDS.a3,
    code: 'RX',
    name: 'Rex.Air (Test)[1]',
    isActive: true,
  });

  const hotelsSeed: HotelView[] = [
    makeHotel(IDS.h1, 'Cairo Grand', {
      cityId: 'cairo',
      countryCode: 'EG',
      isActive: true,
    }),
    makeHotel(IDS.h2, 'Luxor Palace', {
      cityId: 'luxor',
      countryCode: 'EG',
      isActive: false,
    }),
    makeHotel(IDS.h3, 'Nile.Suites (VIP)[2]', {
      cityId: 'aswan',
      countryCode: 'EG',
      isActive: true,
    }),
    makeHotel(IDS.h4, 'Red Sea Resort', {
      cityId: 'hurghada',
      countryCode: 'EG',
      isActive: true,
    }),
  ];

  const accountsSeed: FakeAccountSeed[] = [
    // a1: 2 moderators (1 active, 1 suspended)
    {
      id: 'mod-a1-1',
      name: 'Mod A1 Active',
      email: 'a1-1@example.com',
      role: UserRole.AIRLINE_MODERATOR,
      status: UserStatus.ACTIVE,
      moderatorOf: { providerType: ProviderType.AIRLINE, providerId: IDS.a1 },
    },
    {
      id: 'mod-a1-2',
      name: 'Mod A1 Suspended',
      email: 'a1-2@example.com',
      role: UserRole.AIRLINE_MODERATOR,
      status: UserStatus.SUSPENDED,
      moderatorOf: { providerType: ProviderType.AIRLINE, providerId: IDS.a1 },
    },
    // h1: 1 moderator
    {
      id: 'mod-h1-1',
      name: 'Mod H1',
      email: 'h1-1@example.com',
      role: UserRole.HOTEL_MODERATOR,
      status: UserStatus.ACTIVE,
      moderatorOf: { providerType: ProviderType.HOTEL, providerId: IDS.h1 },
    },
    // other provider: must not be counted for our providers
    {
      id: 'mod-other',
      name: 'Mod Other',
      email: 'other@example.com',
      role: UserRole.HOTEL_MODERATOR,
      status: UserStatus.ACTIVE,
      moderatorOf: {
        providerType: ProviderType.HOTEL,
        providerId: IDS.other,
      },
    },
    // mismatched providerType for IDS.a2: must not be counted
    {
      id: 'mod-mismatch',
      name: 'Mod Mismatch',
      email: 'mismatch@example.com',
      role: UserRole.HOTEL_MODERATOR,
      status: UserStatus.ACTIVE,
      moderatorOf: { providerType: ProviderType.HOTEL, providerId: IDS.a2 },
    },
  ];

  return {
    fakeFlights: new FakeFlightsService(flightsData),
    fakeHotels: new FakeHotelsService({ hotels: hotelsSeed }),
    fakeAccounts: new FakeAccountsService(accountsSeed),
  };
}

describe('Admin Providers API (BE-01)', () => {
  let testApp: TestApp | undefined;
  let fakeFlights: FakeFlightsService;
  let fakeHotels: FakeHotelsService;
  let fakeAccounts: FakeAccountsService;

  beforeAll(async () => {
    const seeds = buildSeeds();
    fakeFlights = seeds.fakeFlights;
    fakeHotels = seeds.fakeHotels;
    fakeAccounts = seeds.fakeAccounts;

    testApp = await createTestApp({
      imports: [AdminModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(fakeFlights)
          .overrideProvider(HotelsService)
          .useValue(fakeHotels)
          .overrideProvider(AccountsService)
          .useValue(fakeAccounts),
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await testApp?.close();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(testApp!.connection);
    vi.restoreAllMocks();
  });

  async function adminCookie(): Promise<string> {
    const admin = await loginAs(testApp!.connection, UserRole.ADMIN);
    return admin.cookie;
  }

  it('registers Swagger metadata for GET /api/admin/providers with BE-01, admin tag, 401 and 403', () => {
    const document = SwaggerModule.createDocument(
      testApp!.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );

    const pathItem = document.paths['/api/admin/providers'];
    expect(pathItem?.get).toBeDefined();
    expect(pathItem?.get?.tags).toContain('admin');
    expect(pathItem?.get?.summary).toContain('BE-01');
    expect(pathItem?.get?.responses?.['401']).toBeDefined();
    expect(pathItem?.get?.responses?.['403']).toBeDefined();
  });

  describe('Auth & RBAC', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const res = await testApp!.http().get('/api/admin/providers');

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        statusCode: 401,
        code: ErrorCode.NotAuthenticated,
      });
    });

    it.each([
      UserRole.USER,
      UserRole.AIRLINE_MODERATOR,
      UserRole.HOTEL_MODERATOR,
    ])('returns 403 FORBIDDEN_ROLE for %s', async (role) => {
      const actor = await loginAs(testApp!.connection, role, {
        providerId: new Types.ObjectId().toHexString(),
      });

      const res = await testApp!
        .http()
        .get('/api/admin/providers')
        .set('Cookie', actor.cookie);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        statusCode: 403,
        code: ErrorCode.ForbiddenRole,
      });
    });
  });

  describe('Response shape, moderator counts and filters', () => {
    it('returns 200 with exact paginated shape, no extra fields, and moderator counts 0/1/2', async () => {
      const cookie = await adminCookie();
      const countSpy = vi.spyOn(fakeAccounts, 'countModeratorsByProviders');

      const res = await testApp!
        .http()
        .get('/api/admin/providers')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 7,
        totalPages: 1,
      });
      expect(Object.keys(res.body).sort()).toEqual([
        'items',
        'limit',
        'page',
        'total',
        'totalPages',
      ]);
      expect(res.body.items).toHaveLength(7);

      // Airlines first (EgyptAir, Nile Air, Rex.Air (Test)[1]), then Hotels (Cairo Grand, Luxor Palace, Nile.Suites (VIP)[2], Red Sea Resort)
      expect(res.body.items[0]).toEqual({
        _id: IDS.a1,
        type: 'airline',
        name: 'EgyptAir',
        status: 'active',
        moderatorCount: 2,
        code: 'MS',
      });
      expect(res.body.items[1]).toEqual({
        _id: IDS.a2,
        type: 'airline',
        name: 'Nile Air',
        status: 'inactive',
        moderatorCount: 0,
        code: 'NL',
      });
      expect(res.body.items[3]).toEqual({
        _id: IDS.h1,
        type: 'hotel',
        name: 'Cairo Grand',
        status: 'active',
        moderatorCount: 1,
        cityId: 'cairo',
        countryCode: 'EG',
      });

      for (const item of res.body.items as Record<string, unknown>[]) {
        const expectedKeys =
          item.type === 'airline' ? AIRLINE_KEYS : HOTEL_KEYS;
        expect(Object.keys(item).sort()).toEqual(expectedKeys);
      }

      expect(countSpy).toHaveBeenCalledTimes(1);
    });

    it('filters type=airline without calling HotelsService', async () => {
      const cookie = await adminCookie();
      const hotelsSpy = vi.spyOn(fakeHotels, 'listHotels');
      const countSpy = vi.spyOn(fakeAccounts, 'countModeratorsByProviders');

      const res = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ type: 'airline' })
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(
        res.body.items.every(
          (i: { type: string }) => i.type === 'airline',
        ),
      ).toBe(true);
      expect(hotelsSpy).not.toHaveBeenCalled();
      expect(countSpy).toHaveBeenCalledTimes(1);
    });

    it('filters type=hotel without calling FlightsService', async () => {
      const cookie = await adminCookie();
      const flightsSpy = vi.spyOn(fakeFlights, 'listAirlines');
      const countSpy = vi.spyOn(fakeAccounts, 'countModeratorsByProviders');

      const res = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ type: 'hotel' })
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4);
      expect(
        res.body.items.every((i: { type: string }) => i.type === 'hotel'),
      ).toBe(true);
      expect(flightsSpy).not.toHaveBeenCalled();
      expect(countSpy).toHaveBeenCalledTimes(1);
    });

    it('filters status=active and status=inactive', async () => {
      const cookie = await adminCookie();

      const activeRes = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ status: 'active' })
        .set('Cookie', cookie);
      expect(activeRes.status).toBe(200);
      expect(activeRes.body.total).toBe(5);
      expect(
        activeRes.body.items.every(
          (i: { status: string }) => i.status === 'active',
        ),
      ).toBe(true);

      const inactiveRes = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ status: 'inactive' })
        .set('Cookie', cookie);
      expect(inactiveRes.status).toBe(200);
      expect(inactiveRes.body.total).toBe(2);
      expect(inactiveRes.body.items.map((i: { _id: string }) => i._id)).toEqual([
        IDS.a2,
        IDS.h2,
      ]);
    });

    it('combines type, status and q', async () => {
      const cookie = await adminCookie();

      const res = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ type: 'airline', status: 'inactive', q: 'nile' })
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items.map((i: { _id: string }) => i._id)).toEqual([
        IDS.a2,
      ]);
    });
  });

  describe('Search q and escaping', () => {
    it('matches q case-insensitively and partially on name and airline code', async () => {
      const cookie = await adminCookie();

      const byName = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ q: 'nile' })
        .set('Cookie', cookie);
      expect(byName.status).toBe(200);
      expect(byName.body.items.map((i: { _id: string }) => i._id)).toEqual([
        IDS.a2,
        IDS.h3,
      ]);

      const byCode = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ q: 'ms' })
        .set('Cookie', cookie);
      expect(byCode.status).toBe(200);
      expect(byCode.body.items.map((i: { _id: string }) => i._id)).toEqual([
        IDS.a1,
      ]);
    });

    it('matches regex metacharacters literally and never matches all or returns 500', async () => {
      const cookie = await adminCookie();

      for (const regexInput of ['.*', '(', '[', '.*([']) {
        const res = await testApp!
          .http()
          .get('/api/admin/providers')
          .query({ q: regexInput })
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.total).toBeLessThan(7);
      }

      const exactSpecial = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ q: '(test)[1]' })
        .set('Cookie', cookie);
      expect(exactSpecial.status).toBe(200);
      expect(
        exactSpecial.body.items.map((i: { _id: string }) => i._id),
      ).toEqual([IDS.a3]);
    });

    it('treats whitespace-only q as absent and returns empty result cleanly', async () => {
      const cookie = await adminCookie();
      const countSpy = vi.spyOn(fakeAccounts, 'countModeratorsByProviders');

      const whitespace = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ q: '   ' })
        .set('Cookie', cookie);
      expect(whitespace.status).toBe(200);
      expect(whitespace.body.total).toBe(7);
      expect(countSpy).toHaveBeenCalledTimes(1);

      countSpy.mockClear();
      const empty = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ q: 'no-such-provider-xyz' })
        .set('Cookie', cookie);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
      expect(countSpy).not.toHaveBeenCalled();
    });
  });

  describe('Validation errors', () => {
    it.each([
      { label: 'over-length q', query: { q: 'a'.repeat(101) } },
      { label: 'unknown type', query: { type: 'train' } },
      { label: 'unknown status', query: { status: 'suspended' } },
      { label: 'page=0', query: { page: '0' } },
      { label: 'limit=0', query: { limit: '0' } },
      { label: 'limit above max', query: { limit: '51' } },
      { label: 'non-numeric page', query: { page: 'abc' } },
    ])('returns 400 VALIDATION_FAILED for $label', async ({ query }) => {
      const cookie = await adminCookie();

      const res = await testApp!
        .http()
        .get('/api/admin/providers')
        .query(query)
        .set('Cookie', cookie);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        code: ErrorCode.ValidationFailed,
      });
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details.length).toBeGreaterThan(0);
    });
  });

  describe('Pagination boundaries and arithmetic split', () => {
    it('splits 3 airlines and 4 hotels cleanly for limit=5 across page 1 and page 2', async () => {
      const cookie = await adminCookie();

      const page1 = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ page: 1, limit: 5 })
        .set('Cookie', cookie);
      expect(page1.status).toBe(200);
      expect(page1.body).toMatchObject({
        page: 1,
        limit: 5,
        total: 7,
        totalPages: 2,
      });
      expect(page1.body.items.map((i: { _id: string }) => i._id)).toEqual([
        IDS.a1,
        IDS.a2,
        IDS.a3,
        IDS.h1,
        IDS.h2,
      ]);

      const page2 = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ page: 2, limit: 5 })
        .set('Cookie', cookie);
      expect(page2.status).toBe(200);
      expect(page2.body).toMatchObject({
        page: 2,
        limit: 5,
        total: 7,
        totalPages: 2,
      });
      expect(page2.body.items.map((i: { _id: string }) => i._id)).toEqual([
        IDS.h3,
        IDS.h4,
      ]);
    });

    it('matches limit=50 concatenation across all pages for limits 1, 2, 3 and 5 with no gaps or duplicates', async () => {
      const cookie = await adminCookie();

      const full = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ page: 1, limit: 50 })
        .set('Cookie', cookie);
      expect(full.status).toBe(200);
      const expectedIds = full.body.items.map((i: { _id: string }) => i._id);
      expect(expectedIds).toHaveLength(7);

      for (const limit of [1, 2, 3, 5]) {
        const totalPages = Math.ceil(7 / limit);
        const collected: string[] = [];
        for (let page = 1; page <= totalPages; page += 1) {
          const res = await testApp!
            .http()
            .get('/api/admin/providers')
            .query({ page, limit })
            .set('Cookie', cookie);
          expect(res.status).toBe(200);
          collected.push(
            ...res.body.items.map((i: { _id: string }) => i._id),
          );
        }
        expect(collected).toEqual(expectedIds);
        expect(new Set(collected).size).toBe(expectedIds.length);
      }
    });

    it('returns empty items with correct total past the end without calling countModeratorsByProviders', async () => {
      const cookie = await adminCookie();
      const countSpy = vi.spyOn(fakeAccounts, 'countModeratorsByProviders');

      const res = await testApp!
        .http()
        .get('/api/admin/providers')
        .query({ page: 10, limit: 5 })
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [],
        page: 10,
        limit: 5,
        total: 7,
        totalPages: 2,
      });
      expect(countSpy).not.toHaveBeenCalled();
    });
  });
});
