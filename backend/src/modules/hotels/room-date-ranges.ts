import { BadRequestException } from '@nestjs/common';
import { addDays, isDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { RoomDateRange } from './hotels.types.js';

export function assertDateRange(fromDate: Date, toDate: Date): void {
  if (!isDateOnly(fromDate) || !isDateOnly(toDate) || toDate < fromDate) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Dates must be UTC calendar dates in ascending order',
    });
  }
}

export function assertStayDates(checkIn: Date, checkOut: Date): void {
  assertDateRange(checkIn, checkOut);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (checkOut <= checkIn || checkIn < today) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Check-in cannot be in the past; check-out must follow check-in',
    });
  }
}

export function normalizeAvailability(
  ranges: RoomDateRange[],
): RoomDateRange[] {
  for (const range of ranges) assertDateRange(range.fromDate, range.toDate);
  const sorted = structuredClone(ranges).sort(
    (a, b) => a.fromDate.getTime() - b.fromDate.getTime(),
  );
  const normalized: RoomDateRange[] = [];
  for (const range of sorted) {
    const previous = normalized.at(-1);
    if (previous && range.fromDate <= previous.toDate) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Availability ranges must not overlap',
      });
    }
    if (
      previous &&
      range.fromDate.getTime() === addDays(previous.toDate, 1).getTime()
    ) {
      previous.toDate = range.toDate;
    } else {
      normalized.push(range);
    }
  }
  return normalized;
}
