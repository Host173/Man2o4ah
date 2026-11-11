import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import mongoose from 'mongoose';
import { toErrorBody } from './error-body.js';
import { ErrorCode } from './error-codes.js';

const now = new Date('2026-11-20T10:00:00.000Z');
const path = '/api/flight-bookings/hold';

function run(exception: unknown) {
  return toErrorBody(exception, path, now);
}

describe('toErrorBody', () => {
  it('uses the code, message and details of an HttpException that has a code', () => {
    const details = [{ field: 'passengers', message: 'too many' }];
    const { statusCode, body } = run(
      new ConflictException({
        code: ErrorCode.SeatsUnavailable,
        message: 'Not enough seats left in Economy',
        details,
      }),
    );
    expect(statusCode).toBe(409);
    expect(body).toEqual({
      statusCode: 409,
      code: 'SEATS_UNAVAILABLE',
      message: 'Not enough seats left in Economy',
      details,
      path,
      timestamp: '2026-11-20T10:00:00.000Z',
    });
  });

  it('leaves out details when a coded HttpException has none or a non-array', () => {
    const none = run(
      new NotFoundException({ code: ErrorCode.NotFound, message: 'Gone' }),
    );
    expect(none.body).not.toHaveProperty('details');
    const notArray = run(
      new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Gone',
        details: 'x',
      }),
    );
    expect(notArray.body).not.toHaveProperty('details');
  });

  it('maps a plain 400 to VALIDATION_FAILED without details', () => {
    const { statusCode, body } = run(new BadRequestException('x'));
    expect(statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).toBe('x');
    expect(body).not.toHaveProperty('details');
  });

  it('maps 401, 403, 404 and 409 without a code by status', () => {
    expect(run(new UnauthorizedException()).body.code).toBe(
      'NOT_AUTHENTICATED',
    );
    expect(run(new ForbiddenException()).body.code).toBe('FORBIDDEN_ROLE');
    expect(run(new NotFoundException()).body.code).toBe('NOT_FOUND');
    expect(run(new ConflictException()).body.code).toBe('CONFLICT');
  });

  it('maps any other 4xx to REQUEST_FAILED', () => {
    const { statusCode, body } = run(new HttpException('Slow down', 429));
    expect(statusCode).toBe(429);
    expect(body.code).toBe('REQUEST_FAILED');
    expect(body.message).toBe('Slow down');
  });

  it('maps a 5xx HttpException without a code to INTERNAL_ERROR', () => {
    const { statusCode, body } = run(new ServiceUnavailableException());
    expect(statusCode).toBe(503);
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('joins an array message with "; "', () => {
    const { body } = run(
      new BadRequestException({ message: ['a is wrong', 'b is wrong'] }),
    );
    expect(body.message).toBe('a is wrong; b is wrong');
  });

  it('maps a Mongo duplicate key to 409 CONFLICT with one detail per key', () => {
    const { statusCode, body } = run({
      code: 11000,
      keyValue: { email: 'a@b.c', name: 'x' },
    });
    expect(statusCode).toBe(409);
    expect(body.code).toBe('CONFLICT');
    expect(body.message).toBe('Duplicate value');
    expect(body.details).toEqual([
      { field: 'email', message: 'already exists' },
      { field: 'name', message: 'already exists' },
    ]);
  });

  it('omits details for a duplicate key without keyValue', () => {
    const { statusCode, body } = run({ code: 11000 });
    expect(statusCode).toBe(409);
    expect(body).not.toHaveProperty('details');
  });

  it('maps a Mongoose ValidationError to 400 with one detail per field', async () => {
    const Model = mongoose.model(
      'ErrorBodySpec',
      new mongoose.Schema({ title: { type: String, required: true } }),
    );
    const error: unknown = await new Model({}).validate().then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
    const { statusCode, body } = run(error);
    expect(statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).toBe('Validation failed');
    expect(body.details).toHaveLength(1);
    expect(body.details?.[0]?.field).toBe('title');
  });

  it('maps a Mongoose CastError to 400 with the path', () => {
    const { statusCode, body } = run(
      new mongoose.Error.CastError('ObjectId', 'abc', '_id'),
    );
    expect(statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).toBe('Invalid value');
    expect(body.details).toEqual([{ field: '_id', message: 'invalid value' }]);
  });

  it('maps anything else to 500 without a stack or the original message', () => {
    const error = new Error('secret detail');
    const { statusCode, body } = run(error);
    expect(statusCode).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('Internal server error');
    expect(body).not.toHaveProperty('stack');
    expect(body).not.toHaveProperty('details');
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it('maps a thrown non-object to 500', () => {
    expect(run('boom').statusCode).toBe(500);
    expect(run(null).statusCode).toBe(500);
  });

  it('uses the current time when no clock is given', () => {
    const { body } = toErrorBody(new Error('x'), path);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
