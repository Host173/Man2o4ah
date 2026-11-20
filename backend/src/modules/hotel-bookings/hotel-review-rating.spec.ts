import { toHotelRatingSummary } from './hotel-review-rating.js';

describe('toHotelRatingSummary', () => {
  it('uses a null average when there are no visible reviews', () => {
    expect(toHotelRatingSummary(null, 0)).toEqual({ average: null, count: 0 });
  });

  it('rounds a non-empty average to one decimal place', () => {
    expect(toHotelRatingSummary(4.26, 3)).toEqual({
      average: 4.3,
      count: 3,
    });
  });

  it('rejects a non-empty aggregate without an average', () => {
    expect(() => toHotelRatingSummary(null, 1)).toThrow(
      'A non-empty review aggregate must include an average.',
    );
  });
});
