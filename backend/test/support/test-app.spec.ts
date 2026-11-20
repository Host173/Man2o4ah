import { existsSync } from 'node:fs';
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthModule } from '../../src/health/health.module.js';
import { UserRole } from '../../src/modules/accounts/schemas/user.schema.js';
import { loginAs } from './auth.js';
import { HOOK_TIMEOUT } from './mongo-memory.js';
import { createTestApp } from './test-app.js';
import type { TestApp } from './test-app.js';

/** A route without `@Public()`, to prove the global guards are on. */
@Controller('guarded-probe')
class GuardedProbeController {
  @Get()
  get() {
    return { ok: true };
  }
}

describe('createTestApp', () => {
  let t: TestApp;
  let closed = false;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HealthModule],
      controllers: [GuardedProbeController],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (!closed) await t.close();
  }, HOOK_TIMEOUT);

  it('gives the config the temporary upload folder', () => {
    expect(t.moduleRef.get(ConfigService).get('UPLOAD_DIR')).toBe(t.uploadDir);
  });

  it('serves the module under the /api prefix with the database wired', async () => {
    const res = await t.http().get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
  });

  it('runs the global auth guards: a route without @Public() needs a login', async () => {
    const res = await t.http().get('/api/guarded-probe').expect(401);
    expect(res.body.code).toBe('NOT_AUTHENTICATED');
  });

  it('lets a loginAs user through the global guards', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    await t
      .http()
      .get('/api/guarded-probe')
      .set('Cookie', user.cookie)
      .expect(200, { ok: true });
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
