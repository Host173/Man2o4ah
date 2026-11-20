import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';
import { ActiveBookingsCheckRegistry } from './ports/active-bookings-check.registry.js';

describe('accounts contract (wiring)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [AccountsModule] });
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it.each([
    ['AccountsService', AccountsService],
    ['ActiveBookingsCheckRegistry', ActiveBookingsCheckRegistry],
  ])('exports %s', (_name, token) => {
    expect(t.moduleRef.get(token, { strict: false })).toBeInstanceOf(token);
  });
});
