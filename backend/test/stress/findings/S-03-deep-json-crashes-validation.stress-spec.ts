/**
 * S-03 · HIGH · input
 *
 * Rule broken: backend.md §6 / api-contract §3 — invalid input is a 400 with
 * `{ code, message, details? }`; "never a raw … error", and a client must not
 * be able to make the server throw (GEN-13: the backend enforces validation).
 *
 * What breaks: a JSON body nested 10 000 levels deep (≈ 60 KB, well under the
 * body limit) on any route with a DTO — e.g. the public POST /api/auth/login
 * and /api/auth/register — answers 500 INTERNAL_ERROR: "Maximum call stack
 * size exceeded". Every such request burns a full stack overflow, and it is
 * reachable without logging in.
 *
 * Cause: src/app.setup.ts:27-32 — the global `ValidationPipe({ transform:
 * true, whitelist: true })` runs class-transformer's `plainToInstance` on the
 * raw body, which recurses into every nested object (even unknown, to-be-
 * stripped keys) and overflows the stack; body parsing (Nest's default
 * express.json, no depth limit) accepts the body first.
 *
 * Suggested fix: reject over-deep bodies before validation (a JSON depth
 * check at parse time or in a global pipe/middleware) with 400
 * VALIDATION_FAILED (or 413), so the DTO pipeline never sees them.
 */
import { isErrorShape } from '../support/flows.js';
import { createStressApp, type Stress } from '../support/stress-app.js';

describe('S-03 deeply nested JSON bodies', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(() => s?.close());

  it('answers 400 in the JSON error shape, never 500', async () => {
    const deep = `${'{"a":'.repeat(10_000)}1${'}'.repeat(10_000)}`;
    for (const path of [
      '/api/auth/login',
      '/api/auth/register',
      '/api/posts',
    ]) {
      const res = await s.t
        .http()
        .post(path)
        .set('Content-Type', 'application/json')
        .send(deep);
      expect(
        { path, status: res.status, shape: isErrorShape(res.body) },
        'backend.md §6: invalid input → 400 with the error shape, never 500',
      ).toEqual({ path, status: 400, shape: true });
    }
    expect((await s.guest().get('/health')).status).toBe(200);
  });
});
