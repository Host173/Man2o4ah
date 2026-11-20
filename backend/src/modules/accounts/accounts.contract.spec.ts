import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
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
  beforeEach(() => clearCollections(t.connection));

  it('requires a live caller transaction for the booking confirmation fence', async () => {
    const u = await loginAs(t.connection, 'user');
    const accounts = t.moduleRef.get(AccountsService);
    const session = await t.connection.startSession();
    try {
      await expect(
        accounts.tryLockForBookingConfirmation(u.id, { session }),
      ).rejects.toThrow(/active transaction/);
      await session.withTransaction(async () => {
        await expect(
          accounts.tryLockForBookingConfirmation(u.id, { session }),
        ).resolves.toBe(true);
      });
    } finally {
      await session.endSession();
    }
  });

  it.each([
    ['AccountsService', AccountsService],
    ['ActiveBookingsCheckRegistry', ActiveBookingsCheckRegistry],
  ])('exports %s', (_name, token) => {
    expect(t.moduleRef.get(token, { strict: false })).toBeInstanceOf(token);
  });
});
