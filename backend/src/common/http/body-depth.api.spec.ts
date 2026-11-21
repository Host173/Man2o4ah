import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { CanActivate, RawBodyRequest } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { MAX_BODY_DEPTH } from './body-depth.js';

class NameDto {
  @IsString()
  name!: string;
}

class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Controller('probe')
class ProbeController {
  @Post('dto')
  dto(@Body() body: NameDto) {
    return body;
  }

  @Post('guarded')
  @UseGuards(DenyGuard)
  guarded(@Body() body: NameDto) {
    return body;
  }

  @Post('raw')
  raw(@Req() req: RawBodyRequest<Request>) {
    return { length: req.rawBody?.length };
  }
}

function deepJson(levels: number): string {
  return `${'{"a":'.repeat(levels)}1${'}'.repeat(levels)}`;
}

describe('over-deep bodies (API)', () => {
  let app: NestExpressApplication;
  let uploadDir: string;

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'body-depth-spec-'));
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureApp(app, { uploadDir, frontendUrl: 'http://localhost:3000' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const post = (path: string, body: string, type = 'application/json') =>
    request(app.getHttpServer())
      .post(path)
      .set('Content-Type', type)
      .send(body);

  it('answers a deep body on a DTO route with 400 in the error shape', async () => {
    const res = await post('/api/probe/dto', deepJson(10_000)).expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      path: '/api/probe/dto',
    });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('answers 400, not 403, when a guard would refuse the request', async () => {
    await post('/api/probe/guarded', deepJson(10_000)).expect(400);
  });

  it('accepts a body at the limit and keeps the raw body', async () => {
    const body = deepJson(MAX_BODY_DEPTH - 1);
    const res = await post('/api/probe/raw', body).expect(201);
    expect(res.body).toEqual({ length: Buffer.byteLength(body) });
  });

  it('answers a deep urlencoded body with 400', async () => {
    const key = `a${'[a]'.repeat(40)}`;
    await post(
      '/api/probe/dto',
      `${key}=1`,
      'application/x-www-form-urlencoded',
    ).expect(400);
  });

  it('keeps serving after a deep body', async () => {
    await post('/api/probe/dto', deepJson(10_000)).expect(400);
    await post('/api/probe/dto', '{"name":"ok"}').expect(201);
  });
});
