/**
 * S-05 · LOW · input
 *
 * Rule broken: backend.md §6 / api-contract §3 — every error is JSON
 * `{ code, message }`; TST-03 D6 "unknown routes → 404 JSON, not HTML".
 *
 * What breaks: a path outside the `/api` prefix (e.g. GET /not-api-at-all,
 * GET /) gets Express's default HTML "Cannot GET" page instead of the JSON
 * error shape. Inside /api the shape is right.
 *
 * Cause: src/app.setup.ts:24 `setGlobalPrefix('api')` — Nest's not-found
 * handling (and the global AllExceptionsFilter) only covers routes Nest
 * registers; requests that match nothing outside the prefix fall through to
 * Express's final handler.
 *
 * Suggested fix: register a catch-all not-found handler after the routes (or
 * a middleware for non-/api, non-/uploads paths) that answers 404 with the
 * shared error body.
 */
import { isErrorShape } from '../support/flows.js';
import { createStressApp, type Stress } from '../support/stress-app.js';

describe('S-05 unknown paths outside /api', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(() => s?.close());

  it('answers 404 in the JSON error shape, not HTML', async () => {
    for (const path of ['/not-api-at-all', '/', '/uploads/missing.png']) {
      const res = await s.t.http().get(path);
      expect(
        {
          path,
          status: res.status,
          json: res.type,
          shape: isErrorShape(res.body),
        },
        'api-contract §3: every error is JSON { code, message }',
      ).toEqual({ path, status: 404, json: 'application/json', shape: true });
    }
  });
});
