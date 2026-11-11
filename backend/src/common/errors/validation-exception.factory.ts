import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import type { ErrorDetail } from './error-body.js';
import { ErrorCode } from './error-codes.js';

/** One entry per failed field; nested errors become dotted paths (`passengers.0.firstName`). */
function flatten(errors: ValidationError[], prefix = ''): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const error of errors) {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) {
      details.push({
        field,
        message: Object.values(error.constraints).join('; '),
      });
    }
    if (error.children?.length) {
      details.push(...flatten(error.children, field));
    }
  }
  return details;
}

/** The `exceptionFactory` of the global ValidationPipe. */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'Validation failed',
    details: flatten(errors),
  });
}
