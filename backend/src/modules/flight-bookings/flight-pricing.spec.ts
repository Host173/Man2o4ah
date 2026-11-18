import { priceFlightBooking } from './flight-pricing.js';
import type { PricedPassenger, PricedSegment } from './flight-pricing.js';

const adult = (extraBagCount = 0): PricedPassenger => ({
  type: 'adult',
  extraBagCount,
});
const child = (extraBagCount = 0): PricedPassenger => ({
  type: 'child',
  extraBagCount,
});
const infant = (extraBagCount = 0): PricedPassenger => ({
  type: 'infant',
  extraBagCount,
});

const segment = (fareMinor: number, extraBagPriceMinor = 0): PricedSegment => ({
  fareMinor,
  extraBagPriceMinor,
});

describe('priceFlightBooking (FLT-12, FLT-19)', () => {
  it('charges one adult the cabin fare on a one-way trip', () => {
    expect(priceFlightBooking([segment(20_000)], [adult()])).toEqual({
      seatCount: 1,
      fareTotalMinor: 20_000,
      baggageTotalMinor: 0,
      totalMinor: 20_000,
    });
  });

  it('charges adults and children the full fare and infants 10%, with no seat', () => {
    const price = priceFlightBooking(
      [segment(20_000)],
      [adult(), adult(), child(), infant()],
    );
    expect(price.seatCount).toBe(3); // the infant takes no seat
    expect(price.fareTotalMinor).toBe(3 * 20_000 + 2_000);
  });

  it('rounds the infant fare half up', () => {
    // 10% of 12 345 is 1 234.5 → 1 235
    const price = priceFlightBooking([segment(12_345)], [adult(), infant()]);
    expect(price.fareTotalMinor).toBe(12_345 + 1_235);
  });

  it('prices every segment of a round trip with its own fare', () => {
    const price = priceFlightBooking(
      [segment(20_000), segment(15_000)],
      [adult(), adult()],
    );
    expect(price.fareTotalMinor).toBe(2 * 20_000 + 2 * 15_000);
    expect(price.seatCount).toBe(2); // the same seats on each segment
  });

  it('charges extra bags on every segment at that segment airline’s price', () => {
    // 3 extra bags in total: 3 × 3 000 outbound + 3 × 2 500 return
    const price = priceFlightBooking(
      [segment(20_000, 3_000), segment(15_000, 2_500)],
      [adult(2), child(1)],
    );
    expect(price.baggageTotalMinor).toBe(3 * 3_000 + 3 * 2_500);
  });

  it('counts an infant’s extra bags too', () => {
    const price = priceFlightBooking(
      [segment(20_000, 3_000)],
      [adult(), infant(1)],
    );
    expect(price.baggageTotalMinor).toBe(3_000);
  });

  it('adds fares and baggage into the total', () => {
    const price = priceFlightBooking(
      [segment(20_000, 3_000), segment(15_000, 2_500)],
      [adult(1), infant()],
    );
    const fares = 20_000 + 2_000 + 15_000 + 1_500;
    const baggage = 3_000 + 2_500;
    expect(price).toEqual({
      seatCount: 1,
      fareTotalMinor: fares,
      baggageTotalMinor: baggage,
      totalMinor: fares + baggage,
    });
  });
});
