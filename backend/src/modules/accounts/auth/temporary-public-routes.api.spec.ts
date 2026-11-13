import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { HealthModule } from '../../../health/health.module.js';
import { AccountsModule } from '../accounts.module.js';

/**
 * The global guards must not lock out the health check, even before its
 * controller gets `@Public()` (TEMPORARY_PUBLIC_ROUTES). This test keeps
 * passing after that change, so it doubles as a regression test.
 */
describe('health check with the global guards (API)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [AccountsModule, HealthModule] });
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('GET /api/health answers 200 without a cookie', async () => {
    const res = await t.http().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('GET /api/health answers 200 with a bad cookie', async () => {
    await t
      .http()
      .get('/api/health')
      .set('Cookie', 'access_token=not-a-jwt')
      .expect(200);
  });
});
