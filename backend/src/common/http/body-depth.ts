import { BadRequestException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ErrorCode } from '../errors/error-codes.js';

/** Most levels a JSON request body may nest. No real payload comes close. */
export const MAX_BODY_DEPTH = 32;

/**
 * True when objects/arrays nest deeper than `maxDepth` (a flat object is 1).
 * Iterative, so a hostile body cannot overflow the stack here either.
 */
export function exceedsDepth(value: unknown, maxDepth: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [node, depth] = item;
    if (typeof node !== 'object' || node === null) continue;
    if (depth > maxDepth) return true;
    for (const child of Object.values(node)) {
      if (typeof child === 'object' && child !== null) {
        stack.push([child, depth + 1]);
      }
    }
  }
  return false;
}

/**
 * Answers 400 for a body nested too deep. class-transformer (inside the
 * validation pipe) recurses on every level and overflows the stack at a few
 * thousand, which would be a 500.
 */
export function rejectDeepBodies(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!exceedsDepth(req.body, MAX_BODY_DEPTH)) return next();
  next(
    new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: `The request body is nested more than ${MAX_BODY_DEPTH} levels deep`,
    }),
  );
}
