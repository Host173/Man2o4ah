import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp, setupSwagger } from '../../app.setup.js';

@Controller('probe')
class ProbeController {
  @Get('ok')
  ok() {
    return { ok: true };
  }
}

describe('404 outside the API prefix (API)', () => {
  let app: NestExpressApplication;
  let uploadDir: string;

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'not-found-spec-'));
    writeFileSync(join(uploadDir, 'present.txt'), 'hello');
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureApp(app, { uploadDir, frontendUrl: 'http://localhost:3000' });
    setupSwagger(app, '0.0.0-test');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it.each([
    ['get', '/'],
    ['get', '/not-api-at-all'],
    ['post', '/elsewhere'],
    ['get', '/apiary'],
    ['get', '/uploads/missing.png'],
  ] as const)('answers %s %s with the JSON 404 shape', async (method, path) => {
    const res = await request(app.getHttpServer())[method](path).expect(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      path,
    });
  });

  it('still serves an uploaded file', async () => {
    const res = await request(app.getHttpServer())
      .get('/uploads/present.txt')
      .expect(200);
    expect(res.text).toBe('hello');
  });

  it('keeps the /api 404 shape and routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', path: '/api/nope' });
    await request(app.getHttpServer()).get('/api/probe/ok').expect(200);
  });

  it('keeps Swagger reachable', async () => {
    const json = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(json.body.openapi).toBeDefined();
    const ui = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(ui.headers['content-type']).toMatch(/html/);
  });

  it('puts CORS headers on the 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/nothing-here')
      .set('Origin', 'http://localhost:3000')
      .expect(404);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
  });
});
