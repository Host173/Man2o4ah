import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { notFoundOutsidePrefix } from './not-found-outside-prefix.js';

function run(originalUrl: string, method = 'GET'): unknown[] {
  const calls: unknown[][] = [];
  notFoundOutsidePrefix('api')(
    { originalUrl, method } as Request,
    {} as Response,
    (...args: unknown[]) => calls.push(args),
  );
  return calls[0] ?? [];
}

describe('notFoundOutsidePrefix', () => {
  it.each(['/api', '/api/', '/api/x?y=1', '/API/health'])(
    'passes %s through',
    (url) => {
      expect(run(url)).toEqual([]);
    },
  );

  it.each(['/', '/apiary', '/uploads/x.png', '/x?y=1'])(
    'answers %s with NotFoundException',
    (url) => {
      const [err] = run(url);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).message).toBe(`Cannot GET ${url}`);
    },
  );
});
