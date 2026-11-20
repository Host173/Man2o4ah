import { refundFor } from './refund-tiers.js';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2027-03-10T00:00:00.000Z');
const tiers = [
  { daysBefore: 3, refundPercent: 50 },
  { daysBefore: 14, refundPercent: 100 },
  { daysBefore: 0, refundPercent: 10 },
];

describe('hotel refund tiers (HTL-10, HTL-21)', () => {
  it.each([
    [20 * DAY, 100],
    [14 * DAY, 100],
    [14 * DAY - 1, 50],
    [3 * DAY, 50],
    [3 * DAY - 1, 10],
    [1, 10],
    [0, 10],
    [-1, 0],
  ])('with %i milliseconds left refunds %i percent', (left, percent) => {
    expect(
      refundFor(tiers, 10_000, start, new Date(start.getTime() - left)),
    ).toEqual({ percent, amountMinor: 100 * percent });
  });

  it('refunds zero when no snapshot tier applies', () => {
    const now = new Date(start.getTime() - DAY);
    expect(refundFor([], 12_345, start, now)).toEqual({
      percent: 0,
      amountMinor: 0,
    });
    expect(refundFor([tiers[0]], 12_345, start, now).percent).toBe(0);
  });

  it('rounds the refund on the full total to integer minor units', () => {
    expect(
      refundFor(tiers, 12_345, start, new Date(start.getTime() - 3 * DAY)),
    ).toEqual({ percent: 50, amountMinor: 6173 });
  });

  it.each([
    [new Date('invalid'), start],
    [start, new Date('invalid')],
  ])(
    'rejects invalid dates instead of silently returning zero',
    (date, now) => {
      expect(() => refundFor(tiers, 100, date, now)).toThrow();
    },
  );
});
