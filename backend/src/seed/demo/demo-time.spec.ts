import {
  addDays,
  arrivalLocalOf,
  firstFlightDay,
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

  it('starts a route tomorrow when its first departure is still ahead', () => {
    // 2027-01-15 12:00 UTC: Cairo 08:30 on the 16th is ahead.
    const now = Date.parse('2027-01-15T12:00:00Z');
    expect(firstFlightDay('2027-01-15', '08:30', 'Africa/Cairo', now)).toBe(1);
  });

  it('starts a route a day later when its first departure already passed', () => {
    // 2027-01-15 23:36 UTC is 03:36 on the 16th in Dubai (UTC+4), so a
    // 02:30 departure on the 16th is in the past and the API would reject it.
    const now = Date.parse('2027-01-15T23:36:00Z');
    expect(firstFlightDay('2027-01-15', '02:30', 'Asia/Dubai', now)).toBe(2);
    expect(firstFlightDay('2027-01-15', '08:30', 'Africa/Cairo', now)).toBe(1);
  });
});
