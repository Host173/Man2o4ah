import { toDateOnly } from '../../common/dates/date-only.js';
import { priceStay } from './stay-pricing.js';

const room = (pricePerNightMinor: number) => ({ pricePerNightMinor });

describe('priceStay (HTL-16)', () => {
  // Nights = check-out minus check-in; the check-out day is not charged.
  it.each([
    ['1 night (the minimum)', '2026-12-10', '2026-12-11', 1],
    ['the 10th to the 13th', '2026-12-10', '2026-12-13', 3],
    ['over a month end', '2027-01-31', '2027-02-02', 2],
    ['through 29 February', '2028-02-28', '2028-03-01', 2],
    ['over the new year', '2026-12-30', '2027-01-02', 3],
  ])('%s is %i night(s)', (_label, checkIn, checkOut, nights) => {
    expect(
      priceStay(toDateOnly(checkIn), toDateOnly(checkOut), [room(10_000)])
        .nights,
    ).toBe(nights);
  });

  it('charges each room its own price for every night', () => {
    const price = priceStay(
      toDateOnly('2026-12-10'),
      toDateOnly('2026-12-13'),
      [room(10_000), room(15_050)],
    );

    expect(price).toEqual({
      nights: 3,
      subtotalsMinor: [30_000, 45_150],
      totalMinor: 75_150,
    });
  });

  it('keeps the subtotals in the order of the rooms', () => {
    const price = priceStay(
      toDateOnly('2026-12-10'),
      toDateOnly('2026-12-11'),
      [room(300), room(100), room(200)],
    );
    expect(price.subtotalsMinor).toEqual([300, 100, 200]);
    expect(price.totalMinor).toBe(600);
  });
});
