import { HOOK_TIMEOUT } from '../../test/support/mongo-memory.js';
import { createTestApp } from '../../test/support/test-app.js';
import type { TestApp } from '../../test/support/test-app.js';
import { AuditModule } from './audit/audit.module.js';
import { AuditService } from './audit/audit.service.js';
import { FxModule } from './fx/fx.module.js';
import { FxService } from './fx/fx.service.js';
import { PayableBookingRegistry } from './payments/ports/payable-booking.registry.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PaymentsService } from './payments/payments.service.js';
import { StripeApiGateway } from './payments/stripe/stripe-api.gateway.js';
import { STRIPE_GATEWAY } from './payments/stripe/stripe-gateway.js';
import { ReferenceDataModule } from './reference-data/reference-data.module.js';
import { ReferenceDataService } from './reference-data/reference-data.service.js';
import { StorageModule } from './storage/storage.module.js';
import { StorageService } from './storage/storage.service.js';

describe('platform contracts (wiring)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [
        PaymentsModule,
        StorageModule,
        FxModule,
        ReferenceDataModule,
        AuditModule,
      ],
    });
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it.each([
    ['PaymentsService', PaymentsService],
    ['PayableBookingRegistry', PayableBookingRegistry],
    ['StorageService', StorageService],
    ['FxService', FxService],
    ['ReferenceDataService', ReferenceDataService],
    ['AuditService', AuditService],
  ])('provides %s', (_name, token) => {
    expect(t.moduleRef.get(token, { strict: false })).toBeInstanceOf(token);
  });

  it('binds STRIPE_GATEWAY to StripeApiGateway', () => {
    expect(t.moduleRef.get(STRIPE_GATEWAY, { strict: false })).toBeInstanceOf(
      StripeApiGateway,
    );
  });
});
