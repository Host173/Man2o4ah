import type { AddressInfo } from 'node:net';
import { vi } from 'vitest';
import { FakeStripeGateway } from '../../../test/fakes/stripe-gateway.fake.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { AccountsSeedModule } from '../../modules/accounts/seed/accounts-seed.module.js';
import { AdminSeedService } from '../../modules/accounts/seed/admin-seed.service.js';
import { AdminModule } from '../../modules/admin/admin.module.js';
import { AuditModule } from '../../modules/audit/audit.module.js';
import { BlogModule } from '../../modules/blog/blog.module.js';
import { FlightBookingsModule } from '../../modules/flight-bookings/flight-bookings.module.js';
import { FlightsModule } from '../../modules/flights/flights.module.js';
import { FX_RATES_CLIENT } from '../../modules/fx/fx-rates.client.js';
import { FxModule } from '../../modules/fx/fx.module.js';
import { HotelBookingsModule } from '../../modules/hotel-bookings/hotel-bookings.module.js';
import { HotelsModule } from '../../modules/hotels/hotels.module.js';
import { ItinerariesModule } from '../../modules/itineraries/itineraries.module.js';
import { ModerationModule } from '../../modules/moderation/moderation.module.js';
import { NotificationsModule } from '../../modules/notifications/notifications.module.js';
import { PaymentsModule } from '../../modules/payments/payments.module.js';
import { STRIPE_GATEWAY } from '../../modules/payments/stripe/stripe-gateway.js';
import { ReferenceDataModule } from '../../modules/reference-data/reference-data.module.js';
import { ReferenceDataSeedService } from '../../modules/reference-data/seed/reference-data-seed.service.js';
import { StorageModule } from '../../modules/storage/storage.module.js';
import { createDemoApi, type DemoApi } from './demo-api.js';
import { buildDemoPlan, type DemoPlan } from './demo-plan.js';
import { addDays } from './demo-time.js';
import { DEMO_KINDS, runDemoSeed, type DemoSeedResult } from './demo-seed.js';

const DEMO_PASSWORD = 'Demo12345';
const ADMIN = { email: 'admin@example.com', password: 'Admin12345' };
const REFERENCE = [
  'countries',
  'cities',
  'airports',
  'attractions',
  'currencies',
];
const SEEDED = [
  'airlines',
  'flights',
  'hotels',
  'rooms',
  'room_nights',
  'users',
];

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

// The seed makes a few hundred calls and every login hashes with bcrypt.
describe('demo seed (PLT-08)', { timeout: 300_000 }, () => {
  let t: TestApp;
  let api: DemoApi;
  let plan: DemoPlan;
  let run1: DemoSeedResult;
  let run2: DemoSeedResult;
  let referenceBefore: Record<string, number>;
  let referenceAfter: Record<string, number>;
  let seededAfterRun1: Record<string, number>;
  let seededAfterRun2: Record<string, number>;

  async function counts(
    names: readonly string[],
  ): Promise<Record<string, number>> {
    const entries = await Promise.all(
      names.map(
        async (name) =>
          [name, await t.connection.collection(name).countDocuments()] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  beforeAll(async () => {
    t = await createTestApp({
      imports: [
        AccountsSeedModule,
        ReferenceDataModule,
        FlightsModule,
        FlightBookingsModule,
        HotelsModule,
        HotelBookingsModule,
        PaymentsModule,
        ItinerariesModule,
        FxModule,
        BlogModule,
        ModerationModule,
        AdminModule,
        NotificationsModule,
        AuditModule,
        StorageModule,
      ],
      override: (builder) =>
        builder
          .overrideProvider(STRIPE_GATEWAY)
          .useValue(new FakeStripeGateway())
          .overrideProvider(FX_RATES_CLIENT)
          .useValue({ fetchLatest: vi.fn() }),
    });
    await t.moduleRef.get(ReferenceDataSeedService).run();
    await t.moduleRef
      .get(AdminSeedService, { strict: false })
      .run({ email: ADMIN.email, password: ADMIN.password });
    await t.app.listen(0, '127.0.0.1');
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    api = createDemoApi(`http://127.0.0.1:${port}/api`);
    plan = buildDemoPlan({
      password: DEMO_PASSWORD,
      adminEmail: ADMIN.email,
      adminPassword: ADMIN.password,
      today: new Date().toISOString().slice(0, 10),
    });

    referenceBefore = await counts(REFERENCE);
    run1 = await runDemoSeed(api, plan, () => undefined);
    seededAfterRun1 = await counts(SEEDED);
    run2 = await runDemoSeed(api, plan, () => undefined);
    seededAfterRun2 = await counts(SEEDED);
    referenceAfter = await counts(REFERENCE);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('creates the whole demo world on the first run', () => {
    const routes = plan.airlines.flatMap((airline) => airline.routes);
    const cabinsPerDay = routes.reduce(
      (sum, route) => sum + route.cabins.length,
      0,
    );
    expect(run1.created).toEqual({
      airlines: 3,
      airlineModerators: 3,
      flights: routes.length * plan.flightDays,
      cabins: cabinsPerDay * plan.flightDays,
      hotels: 4,
      hotelModerators: 4,
      rooms: 16,
      availabilityRanges: 16,
      users: 3,
    });
    for (const kind of DEMO_KINDS) expect(run1.skipped[kind]).toBe(0);
    expect(seededAfterRun1.flights).toBe(routes.length * plan.flightDays);
  });

  it('is a no-op on the second run', () => {
    for (const kind of DEMO_KINDS) expect(run2.created[kind]).toBe(0);
    expect(run2.skipped).toEqual(run1.created);
    expect(seededAfterRun2).toEqual(seededAfterRun1);
  });

  it('never touches the reference data', () => {
    expect(referenceAfter).toEqual(referenceBefore);
  });

  it('leaves accounts that graders can use at once', async () => {
    const moderator = api.fork();
    const login = await moderator.login('nile.mod@example.com', DEMO_PASSWORD);
    expect(login.status).toBe(200);
    expect(field(field(login.body, 'user'), 'mustChangePassword')).toBe(false);

    const tomorrow = addDays(plan.today, 1);
    const flights = await api.get(
      `/flights/search?from=CAI&to=DXB&date=${tomorrow}`,
    );
    expect(flights.status).toBe(200);
    const flightItems = field(flights.body, 'items');
    expect(Array.isArray(flightItems) && flightItems.length).toBeGreaterThan(0);

    const hotels = await api.get(
      `/hotels/search?cityId=cairo&checkIn=${tomorrow}&checkOut=${addDays(tomorrow, 2)}&guests=2`,
    );
    expect(hotels.status).toBe(200);
    const names = (field(hotels.body, 'items') as unknown[]).map((hotel) =>
      field(hotel, 'name'),
    );
    expect(names).toContain('Nile View Hotel');
  });

  it('fails clearly without DEMO_PASSWORD', () => {
    expect(() =>
      buildDemoPlan({
        password: undefined,
        adminEmail: ADMIN.email,
        adminPassword: ADMIN.password,
        today: plan.today,
      }),
    ).toThrow(/DEMO_PASSWORD/);
    expect(() =>
      buildDemoPlan({
        password: 'short',
        adminEmail: ADMIN.email,
        adminPassword: ADMIN.password,
        today: plan.today,
      }),
    ).toThrow(/DEMO_PASSWORD/);
  });
});
