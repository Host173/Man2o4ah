import { addDays, daysBetween, isDateOnly, toDateOnly } from './date-only.js';

describe('date-only helpers', () => {
  it('toDateOnly returns 00:00:00.000Z of the date', () => {
    expect(toDateOnly('2026-03-15').toISOString()).toBe(
      '2026-03-15T00:00:00.000Z',
    );
  });

  it.each([
    '2026-3-15',
    '2026-02-30',
    '2026-13-01',
    '15/03/2026',
    '',
    '2026-03-15T00:00',
  ])('toDateOnly rejects %j', (value) => {
    expect(() => toDateOnly(value)).toThrow();
  });

  it('toDateOnly accepts a leap day only in leap years', () => {
    expect(toDateOnly('2028-02-29').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(() => toDateOnly('2026-02-29')).toThrow();
  });

  it('isDateOnly accepts UTC midnight only', () => {
    expect(isDateOnly(new Date('2026-03-15T00:00:00.000Z'))).toBe(true);
    expect(isDateOnly(new Date('2026-03-15T00:00:00.001Z'))).toBe(false);
    expect(isDateOnly(new Date('2026-03-15T10:00:00.000Z'))).toBe(false);
    expect(isDateOnly(new Date('invalid'))).toBe(false);
    expect(isDateOnly('2026-03-15')).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });

  it('addDays moves forward and back across month ends', () => {
    expect(addDays(toDateOnly('2026-01-31'), 1).toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    expect(addDays(toDateOnly('2026-03-01'), -1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(isDateOnly(addDays(toDateOnly('2026-03-28'), 3))).toBe(true);
  });

  it('daysBetween counts whole days, signed', () => {
    expect(
      daysBetween(toDateOnly('2026-03-10'), toDateOnly('2026-03-15')),
    ).toBe(5);
    expect(
      daysBetween(toDateOnly('2026-03-15'), toDateOnly('2026-03-10')),
    ).toBe(-5);
    expect(
      daysBetween(toDateOnly('2026-03-15'), toDateOnly('2026-03-15')),
    ).toBe(0);
    expect(
      daysBetween(toDateOnly('2026-12-31'), toDateOnly('2027-01-01')),
    ).toBe(1);
  });
});
