import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { validationExceptionFactory } from '../../common/errors/validation-exception.factory.js';
import type { ReferenceDataService } from '../reference-data/reference-data.service.js';
import type { UpdateActivityDto } from './dto/update-activity.dto.js';

/** Keeps HTTP, direct service calls and fakes on the same activity input contract. */
export async function validateActivityInput<T extends UpdateActivityDto>(
  type: ClassConstructor<T>,
  dto: T,
  referenceData: Pick<ReferenceDataService, 'getCurrency'>,
): Promise<T> {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [{ field: 'body', message: 'must be an object' }],
    });
  }
  const input = plainToInstance(type, dto);
  const errors = await validate(input, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) throw validationExceptionFactory(errors);
  if (input.cost && !(await referenceData.getCurrency(input.cost.currency))) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [{ field: 'cost.currency', message: 'Unknown currency' }],
    });
  }
  return input;
}
