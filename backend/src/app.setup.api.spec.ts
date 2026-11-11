import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import request from 'supertest';
import { configureApp } from './app.setup.js';
import { ErrorCode } from './common/errors/error-codes.js';

class NameDto {
  @IsString()
  @MaxLength(5)
  name!: string;
}

@Controller('probe')
class ProbeController {
  @Post('dto')
  dto(@Body() body: NameDto) {
    return body;
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Flight not found',
    });
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictException({
      code: ErrorCode.SeatsUnavailable,
      message: 'x',
    });
  }

  @Get('duplicate')
  duplicate(): never {
    throw Object.assign(new Error('E11000 duplicate key error'), {
      code: 11000,
      keyValue: { email: 'a@b.c' },
    });
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret detail');
  }

  @Get('cookies')
  cookies(@Req() req: Request) {
    return req.cookies;
  }

  @Post('raw')
  raw(@Req() req: RawBodyRequest<Request>) {
    return { length: req.rawBody?.length };
  }
}

describe('configureApp (API)', () => {
  let app: NestExpressApplication;
  let uploadDir: string;

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'uploads-spec-'));
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

  it('answers a validation failure with one detail per bad field', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe/dto')
      .send({ name: 'toolong', extra: 1 })
      .expect(400);
    expect(res.body.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const fields = (res.body.details as { field: string }[]).map(
      (detail) => detail.field,
    );
    expect(fields).toEqual(expect.arrayContaining(['name', 'extra']));
    expect(res.body.path).toBe('/api/probe/dto');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('accepts a valid body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe/dto')
      .send({ name: 'ok' })
      .expect(201);
    expect(res.body).toEqual({ name: 'ok' });
  });

  it('answers an unknown route with the full 404 shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      path: '/api/nope',
    });
    expect(typeof res.body.message).toBe('string');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('keeps the message of a coded NotFoundException', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/not-found')
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Flight not found');
  });

  it('keeps the code of a coded ConflictException', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/conflict')
      .expect(409);
    expect(res.body.code).toBe('SEATS_UNAVAILABLE');
  });

  it('turns a Mongo duplicate key into 409 CONFLICT', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/duplicate')
      .expect(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.details[0].field).toBe('email');
  });

  it('hides the stack and the message of an unexpected error', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/boom')
      .expect(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toHaveProperty('stack');
    expect(res.text).not.toContain('secret detail');
  });

  it('parses cookies', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/cookies')
      .set('Cookie', 'a=1')
      .expect(200);
    expect(res.body).toEqual({ a: '1' });
  });

  it('keeps the raw body', async () => {
    const body = { hello: 'world' };
    const res = await request(app.getHttpServer())
      .post('/api/probe/raw')
      .send(body)
      .expect(201);
    expect(res.body.length).toBe(Buffer.byteLength(JSON.stringify(body)));
  });

  it('serves files from the upload directory under /uploads', async () => {
    writeFileSync(join(uploadDir, 'hello.txt'), 'hello upload');
    const res = await request(app.getHttpServer())
      .get('/uploads/hello.txt')
      .expect(200);
    expect(res.text).toBe('hello upload');
  });
});
