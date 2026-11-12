import { existsSync } from 'node:fs';
import { HealthModule } from '../../src/health/health.module.js';
import { HOOK_TIMEOUT } from './mongo-memory.js';
import { createTestApp } from './test-app.js';
import type { TestApp } from './test-app.js';

describe('createTestApp', () => {
  let t: TestApp;
  let closed = false;

  beforeAll(async () => {
    t = await createTestApp({ imports: [HealthModule] });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (!closed) await t.close();
  }, HOOK_TIMEOUT);

  it('serves the module under the /api prefix with the database wired', async () => {
    const res = await t.http().get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
  });

  it('answers an unknown route through the error filter', async () => {
    const res = await t.http().get('/api/nope').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.path).toBe('/api/nope');
  });

  it('uses the "test" database on the in-memory server, not Atlas', () => {
    expect(t.connection.name).toBe('test');
    expect(['127.0.0.1', 'localhost']).toContain(t.connection.host);
  });

  it(
    'removes the temporary upload directory on close',
    async () => {
      expect(existsSync(t.uploadDir)).toBe(true);
      await t.close();
      closed = true;
      expect(existsSync(t.uploadDir)).toBe(false);
    },
    HOOK_TIMEOUT,
  );
});
