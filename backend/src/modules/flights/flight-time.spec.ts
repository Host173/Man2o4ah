import { BadRequestException } from '@nestjs/common';
import { convertFlightTimes } from './flight-time.js';

describe('convertFlightTimes', () => {
  const now = new Date('2026-11-19T12:00:00.000Z');

  it('converts airport-local times through the DST change to UTC instants', () => {
    const result = convertFlightTimes(
      '2027-03-14T03:30',
      'America/New_York',
      '2027-03-14T10:00',
      'Africa/Cairo',
      now,
    );

    expect(result).toEqual({
      departureAt: new Date('2027-03-14T07:30:00.000Z'),
      arrivalAt: new Date('2027-03-14T08:00:00.000Z'),
      departureLocalDate: '2027-03-14',
      durationMinutes: 30,
    });
  });

  it('rejects a local time that does not exist when clocks move forward', () => {
    expect(() =>
      convertFlightTimes(
        '2027-03-14T02:30',
        'America/New_York',
        '2027-03-14T10:00',
        'Africa/Cairo',
        now,
      ),
    ).toThrow(BadRequestException);
  });

  it('checks arrival order using UTC instants rather than local clock values', () => {
    const result = convertFlightTimes(
      '2027-01-10T12:00',
      'Africa/Cairo',
      '2027-01-10T06:00',
      'America/New_York',
      now,
    );

    expect(result.departureAt).toEqual(new Date('2027-01-10T10:00:00.000Z'));
    expect(result.arrivalAt).toEqual(new Date('2027-01-10T11:00:00.000Z'));
    expect(result.durationMinutes).toBe(60);
  });

  it('rejects arrival when its UTC instant is not after departure', () => {
    expect(() =>
      convertFlightTimes(
        '2027-01-10T12:00',
        'Africa/Cairo',
        '2027-01-10T13:30',
        'Asia/Dubai',
        now,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects past departures and malformed local date-times', () => {
    expect(() =>
      convertFlightTimes(
        '2020-01-10T12:00',
        'Africa/Cairo',
        '2020-01-10T14:00',
        'Asia/Dubai',
        now,
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      convertFlightTimes(
        '2027-01-10T12:00Z',
        'Africa/Cairo',
        '2027-01-10T14:00',
        'Asia/Dubai',
        now,
      ),
    ).toThrow(BadRequestException);
  });
});
