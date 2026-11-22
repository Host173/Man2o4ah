import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildOpenApiDocument } from '../../src/app.setup.js';
import { HealthModule } from '../../src/health/health.module.js';
import { AdminModule } from '../../src/modules/admin/admin.module.js';
import { AuditModule } from '../../src/modules/audit/audit.module.js';
import { BlogModule } from '../../src/modules/blog/blog.module.js';
import { FlightBookingsModule } from '../../src/modules/flight-bookings/flight-bookings.module.js';
import { FlightsModule } from '../../src/modules/flights/flights.module.js';
import { FxModule } from '../../src/modules/fx/fx.module.js';
import { HotelBookingsModule } from '../../src/modules/hotel-bookings/hotel-bookings.module.js';
import { HotelsModule } from '../../src/modules/hotels/hotels.module.js';
import { ItinerariesModule } from '../../src/modules/itineraries/itineraries.module.js';
import { ModerationModule } from '../../src/modules/moderation/moderation.module.js';
import { NotificationsModule } from '../../src/modules/notifications/notifications.module.js';
import { PaymentsModule } from '../../src/modules/payments/payments.module.js';
import { STRIPE_GATEWAY } from '../../src/modules/payments/stripe/stripe-gateway.js';
import { ReferenceDataModule } from '../../src/modules/reference-data/reference-data.module.js';
import { StorageModule } from '../../src/modules/storage/storage.module.js';
import { ENDPOINTS } from '../audit/requirements-catalog.js';
import { FakeStripeGateway } from '../fakes/index.js';
import { createTestApp } from '../support/test-app.js';
import type { TestApp } from '../support/test-app.js';

// PLT-07: exports the document Swagger UI shows (`setupSwagger`) to
// docs/api/openapi.json. Run with `npm run openapi:export`; not part of CI.
// The modules are those of src/app.module.ts (createTestApp adds AccountsModule),
// on the in-memory database: no data is needed, and backend/.env is never read.
const backendDir = resolve(import.meta.dirname, '../..');
const outFile = resolve(backendDir, '../docs/api/openapi.json');
const HTTP = ['get', 'post', 'put', 'patch', 'delete'] as const;

describe('PLT-07 OpenAPI export', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [
        HealthModule,
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
          .useValue(new FakeStripeGateway()),
    });
  });
  afterAll(() => t?.close());

  it('writes docs/api/openapi.json', () => {
    const { version } = JSON.parse(
      readFileSync(resolve(backendDir, 'package.json'), 'utf8'),
    ) as { version: string };
    const doc = buildOpenApiDocument(t.app, version);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');

    const written = JSON.parse(readFileSync(outFile, 'utf8')) as {
      openapi?: string;
      info?: { version?: string };
      paths: Record<string, Record<string, unknown>>;
    };
    expect(written.openapi).toBeTruthy();
    expect(written.info?.version).toBe(version);
    const operations = Object.values(written.paths).flatMap((item) =>
      HTTP.filter((verb) => item[verb] !== undefined),
    );
    expect(operations.length).toBeGreaterThanOrEqual(ENDPOINTS.length);
  });
});
