import { NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** 404 NOT_FOUND (via the global filter) for any path outside the API prefix that nothing served. */
export function notFoundOutsidePrefix(prefix: string) {
  const base = `/${prefix}`.toLowerCase();
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Express routing is case-insensitive, so /API/health works and must pass.
    const path = (req.originalUrl.split(/[?#]/)[0] ?? '').toLowerCase();
    if (path === base || path.startsWith(`${base}/`)) return next();
    next(new NotFoundException(`Cannot ${req.method} ${req.originalUrl}`));
  };
}
