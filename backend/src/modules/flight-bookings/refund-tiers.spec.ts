import { refundFor } from './refund-tiers.js';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-12-31T12:00:00.000Z');

/** `now` = `start` minus some time, so the test reads as "how long before the trip". */
const before = (ms: number) => new Date(start.getTime() - ms);

// Deliberately not sorted: the rule must not depend on the order of the array.
const tiers = [
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 1, refundPercent: 10 },
];

describe('refundFor (FLT-09, HTL-10)', () => {
  // Decision table: time left before the start → expected refund percent.
  it.each([
    ['45 days', 45 * DAY, 100],
    ['exactly 30 days', 30 * DAY, 100],
    ['1 ms under 30 days (29 full days)', 30 * DAY - 1, 50],
    ['exactly 7 days', 7 * DAY, 50],
    ['1 ms under 7 days (6 full days)', 7 * DAY - 1, 10],
    ['exactly 1 day', 1 * DAY, 10],
    ['1 ms under 1 day (0 full days)', 1 * DAY - 1, 0],
    ['at the start', 0, 0],
    ['1 ms after the start', -1, 0],
  ])('%s before the start refunds %i%%', (_label, msLeft, percent) => {
    expect(refundFor(tiers, 10_000, start, before(msLeft)).percent).toBe(
      percent,
    );
  });

  it('refunds 0% when there are no tiers', () => {
    expect(refundFor([], 10_000, start, before(100 * DAY))).toEqual({
      percent: 0,
      amountMinor: 0,
    });
  });

  it('applies a daysBefore-0 tier until the start, but not after it', () => {
    const sameDay = [{ daysBefore: 0, refundPercent: 25 }];
    expect(refundFor(sameDay, 10_000, start, before(1)).percent).toBe(25);
    expect(refundFor(sameDay, 10_000, start, before(0)).percent).toBe(25);
    expect(refundFor(sameDay, 10_000, start, before(-1)).percent).toBe(0);
  });

  it.each([
    ['now', start, new Date('nope')],
    ['start', new Date('nope'), before(DAY)],
  ])('throws when %s is not a valid date', (_label, startAt, now) => {
    expect(() => refundFor(tiers, 10_000, startAt, now)).toThrow();
  });

  it('computes the amount from the total in minor units', () => {
    expect(refundFor(tiers, 12_345, start, before(10 * DAY))).toEqual({
      percent: 50,
      amountMinor: 6173, // 6172.5 rounds half up
    });
  });

  it('refunds the full total at 100%', () => {
    expect(refundFor(tiers, 12_345, start, before(40 * DAY))).toEqual({
      percent: 100,
      amountMinor: 12_345,
    });
  });
});
