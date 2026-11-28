import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from '../errors/error-codes.js';
import {
  MAX_BODY_DEPTH,
  exceedsDepth,
  rejectDeepBodies,
} from './body-depth.js';

function nested(levels: number): unknown {
  let value: unknown = 1;
  for (let i = 0; i < levels; i++) value = { a: value };
  return value;
}

describe('exceedsDepth', () => {
  it('lets primitives and null through', () => {
    for (const v of [undefined, null, 1, 'x', true]) {
      expect(exceedsDepth(v, 1)).toBe(false);
    }
  });

  it('counts a flat object or array as depth 1', () => {
    expect(exceedsDepth({}, 1)).toBe(false);
    expect(exceedsDepth([], 1)).toBe(false);
    expect(exceedsDepth({ a: {} }, 1)).toBe(true);
    expect(exceedsDepth({ a: {} }, 2)).toBe(false);
  });

  it('counts arrays as levels', () => {
    expect(exceedsDepth([[[]]], 2)).toBe(true);
    expect(exceedsDepth([[[]]], 3)).toBe(false);
  });

  it('passes exactly the limit and fails one more', () => {
    expect(exceedsDepth(nested(MAX_BODY_DEPTH), MAX_BODY_DEPTH)).toBe(false);
    expect(exceedsDepth(nested(MAX_BODY_DEPTH + 1), MAX_BODY_DEPTH)).toBe(true);
  });

  it('handles a 10 000 level body without throwing', () => {
    const deep: unknown = JSON.parse(
      `${'{"a":'.repeat(10_000)}1${'}'.repeat(10_000)}`,
    );
    expect(exceedsDepth(deep, MAX_BODY_DEPTH)).toBe(true);
  });

  it('passes a wide, shallow object', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 5_000; i++) wide[`k${i}`] = i;
    expect(exceedsDepth(wide, MAX_BODY_DEPTH)).toBe(false);
  });
});

describe('rejectDeepBodies', () => {
  const run = (body: unknown): unknown[] => {
    const calls: unknown[][] = [];
    rejectDeepBodies(
      { body } as Request,
      {} as Response,
      (...args: unknown[]) => calls.push(args),
    );
    return calls[0] ?? [];
  };

  it('calls next() with no error when there is no body', () => {
    expect(run(undefined)).toEqual([]);
  });

  it('calls next() with no error for a normal body', () => {
    expect(run({ a: { b: 1 } })).toEqual([]);
  });

  it('calls next() with a 400 VALIDATION_FAILED for a deep body', () => {
    const [err] = run(nested(MAX_BODY_DEPTH + 1));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: ErrorCode.ValidationFailed,
    });
  });
});
