import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { ErrorCode } from '../../common/errors/error-codes.js';

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm";

export interface ConvertedFlightTimes {
  departureAt: Date;
  arrivalAt: Date;
  departureLocalDate: string;
  durationMinutes: number;
}

export function convertFlightTimes(
  departureLocal: string,
  departureTimeZone: string,
  arrivalLocal: string,
  arrivalTimeZone: string,
  now = new Date(),
): ConvertedFlightTimes {
  const departure = parseLocalDateTime(
    departureLocal,
    departureTimeZone,
    'departureLocal',
  );
  const arrival = parseLocalDateTime(
    arrivalLocal,
    arrivalTimeZone,
    'arrivalLocal',
  );

  if (departure.toMillis() <= now.getTime()) {
    throw invalidField('departureLocal', 'must be in the future');
  }

  if (arrival.toMillis() <= departure.toMillis()) {
    throw invalidField('arrivalLocal', 'must be after departure');
  }

  return {
    departureAt: departure.toUTC().toJSDate(),
    arrivalAt: arrival.toUTC().toJSDate(),
    departureLocalDate: departure.toFormat('yyyy-MM-dd'),
    durationMinutes: Math.round(
      (arrival.toMillis() - departure.toMillis()) / 60_000,
    ),
  };
}

export function formatLocalDateTime(instant: Date, timeZone: string): string {
  return DateTime.fromJSDate(instant, { zone: 'UTC' })
    .setZone(timeZone)
    .toFormat(LOCAL_DATE_TIME_FORMAT);
}

function parseLocalDateTime(
  value: string,
  timeZone: string,
  field: string,
): DateTime {
  if (!LOCAL_DATE_TIME.test(value)) {
    throw invalidField(field, 'must use YYYY-MM-DDTHH:mm local time format');
  }

  const dateTime = DateTime.fromISO(value, { zone: timeZone });
  if (
    !dateTime.isValid ||
    dateTime.toFormat(LOCAL_DATE_TIME_FORMAT) !== value
  ) {
    throw invalidField(
      field,
      'must be a valid local date-time in the airport time zone',
    );
  }
  return dateTime;
}

function invalidField(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'Invalid flight',
    details: [{ field, message }],
  });
}
