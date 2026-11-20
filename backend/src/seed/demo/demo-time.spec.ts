import {
  addDays,
  arrivalLocalOf,
  localToUtcMs,
  utcMsToLocal,
} from './demo-time.js';

describe('demo time helpers (PLT-08)', () => {
  it('converts wall-clock time to UTC and back', () => {
    const utc = localToUtcMs('2027-01-15T08:30', 'Africa/Cairo');
    expect(new Date(utc).toISOString()).toBe('2027-01-15T06:30:00.000Z');
    expect(utcMsToLocal(utc, 'Africa/Cairo')).toBe('2027-01-15T08:30');
  });

  it('follows daylight saving time of each zone', () => {
    expect(
      new Date(localToUtcMs('2027-07-01T12:00', 'Europe/London')).toISOString(),
    ).toBe('2027-07-01T11:00:00.000Z');
  });

  it('computes the arrival wall-clock time in the arrival zone', () => {
    // Cairo 08:30 (UTC+2) + 225 min = 10:15 UTC = 14:15 in Dubai (UTC+4).
    expect(
      arrivalLocalOf('2027-01-15T08:30', 'Africa/Cairo', 225, 'Asia/Dubai'),
    ).toBe('2027-01-15T14:15');
  });

  it('adds days across a month end', () => {
    expect(addDays('2027-01-30', 3)).toBe('2027-02-02');
  });
});
