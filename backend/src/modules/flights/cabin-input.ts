import { BadRequestException } from '@nestjs/common';
import { CabinClass } from '../../common/database/cabin-class.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { AddCabinInput } from './flights.types.js';

export function validateCabinInput(input: AddCabinInput): void {
  if (!Object.values(CabinClass).includes(input.cabinClass)) {
    throw invalid('cabinClass', 'is not a supported cabin class');
  }
  if (!Number.isSafeInteger(input.totalSeats) || input.totalSeats < 1) {
    throw invalid('totalSeats', 'must be a positive safe integer');
  }
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 1) {
    throw invalid('priceMinor', 'must be a positive safe integer');
  }
  if (!Number.isSafeInteger(input.freeBags) || input.freeBags < 0) {
    throw invalid('freeBags', 'must be a non-negative safe integer');
  }
  if (
    typeof input.maxBagWeightKg !== 'number' ||
    !Number.isFinite(input.maxBagWeightKg) ||
    input.maxBagWeightKg <= 0
  ) {
    throw invalid('maxBagWeightKg', 'must be a positive number');
  }
}

function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'Invalid flight',
    details: [{ field, message }],
  });
}
