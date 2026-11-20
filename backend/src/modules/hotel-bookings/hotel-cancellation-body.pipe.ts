import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { CancelHotelReservationDto } from './dto/hotel-cancellation.dto.js';

/** The global ValidationPipe cannot reject arrays for a DTO with no properties. */
@Injectable()
export class HotelCancellationBodyPipe implements PipeTransform<
  unknown,
  CancelHotelReservationDto
> {
  transform(value: unknown): CancelHotelReservationDto {
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
