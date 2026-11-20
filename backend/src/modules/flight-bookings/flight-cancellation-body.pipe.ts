import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { CancelFlightBookingDto } from './dto/flight-cancellation.dto.js';

/** The global ValidationPipe cannot reject arrays for a DTO with no properties. */
@Injectable()
export class FlightCancellationBodyPipe implements PipeTransform<
  unknown,
  CancelFlightBookingDto
> {
  transform(value: unknown): CancelFlightBookingDto {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Cancellation confirmation must be an empty object',
        details: [{ field: 'body', message: 'must be an empty object' }],
      });
    }
    return value;
  }
}
