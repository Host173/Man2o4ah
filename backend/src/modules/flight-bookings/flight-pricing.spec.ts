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

const segment = (
  fareMinor: number,
  extraBagPriceMinor = 0,
  airlineId = 'airline-A',
): PricedSegment => ({
  airlineId,
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

  it('charges each airline’s extra-bag price once when both airlines differ', () => {
    // 3 extra bags in total: 3 × 3 000 outbound (A) + 3 × 2 500 return (B)
    const price = priceFlightBooking(
      [
        segment(20_000, 3_000, 'airline-A'),
        segment(15_000, 2_500, 'airline-B'),
      ],
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
      [
        segment(20_000, 3_000, 'airline-A'),
        segment(15_000, 2_500, 'airline-B'),
      ],
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

  describe('decision table: extra-bag pricing once per airline (FLT-19)', () => {
    it('charges extra bags once for a one-way trip on one airline', () => {
      // 1 adult, 1 bag, airline A ($30)
      const price = priceFlightBooking(
        [segment(20_000, 3_000, 'airline-A')],
        [adult(1)],
      );
      expect(price.baggageTotalMinor).toBe(3_000);
    });

    it('charges extra bags once for a round trip on the same airline', () => {
      // 2 adults with 1 extra bag each (2 bags): airline A ($30) both ways
      // Expected: 2 × $30 = $60 (bug previously charged $120)
      const price = priceFlightBooking(
        [
          segment(20_000, 3_000, 'airline-A'),
          segment(15_000, 3_000, 'airline-A'),
        ],
        [adult(1), adult(1)],
      );
      expect(price.baggageTotalMinor).toBe(2 * 3_000);
    });

    it('charges each airline once for a round trip on two different airlines', () => {
      // 2 adults with 1 extra bag each (2 bags): airline A ($30) out, airline B ($25) back
      // Expected: 2 × $30 + 2 × $25 = $110
      const price = priceFlightBooking(
        [
          segment(20_000, 3_000, 'airline-A'),
          segment(15_000, 2_500, 'airline-B'),
        ],
        [adult(1), adult(1)],
      );
      expect(price.baggageTotalMinor).toBe(2 * 3_000 + 2 * 2_500);
    });

    it('charges zero baggage when no passengers have extra bags', () => {
      const price = priceFlightBooking(
        [
          segment(20_000, 3_000, 'airline-A'),
          segment(15_000, 3_000, 'airline-A'),
        ],
        [adult(0), adult(0)],
      );
      expect(price.baggageTotalMinor).toBe(0);
    });

    it('charges zero baggage when the airline does not sell extra bags (price is 0)', () => {
      const price = priceFlightBooking(
        [segment(20_000, 0, 'airline-A'), segment(15_000, 0, 'airline-A')],
        [adult(1), adult(1)],
      );
      expect(price.baggageTotalMinor).toBe(0);
    });
  });

  describe('decision table: extra-bag pricing once per airline (FLT-19)', () => {
    it('charges extra bags once for a one-way trip on one airline', () => {
      // 1 adult, 1 bag, airline A ($30)
      const price = priceFlightBooking(
        [segment(20_000, 3_000, 'airline-A')],
        [adult(1)],
      );
      expect(price.baggageTotalMinor).toBe(3_000);
    });

    it('charges extra bags once for a round trip on the same airline', () => {
      // 2 adults with 1 extra bag each (2 bags): airline A ($30) both ways
      // Expected: 2 × $30 = $60 (bug previously charged $120)
      const price = priceFlightBooking(
        [
          segment(20_000, 3_000, 'airline-A'),
          segment(15_000, 3_000, 'airline-A'),
        ],
        [adult(1), adult(1)],
      );
      expect(price.baggageTotalMinor).toBe(2 * 3_000);
    });

    it('charges each airline once for a round trip on two different airlines', () => {
      // 2 adults with 1 extra bag each (2 bags): airline A ($30) out, airline B ($25) back
      // Expected: 2 × $30 + 2 × $25 = $110
      const price = priceFlightBooking(
        [
          segment(20_000, 3_000, 'airline-A'),
          segment(15_000, 2_500, 'airline-B'),
        ],
        [adult(1), adult(1)],
      );
      expect(price.baggageTotalMinor).toBe(2 * 3_000 + 2 * 2_500);
    });

    it('charges zero baggage when no passengers have extra bags', () => {
      const price = priceFlightBooking(
        [
          segment(20_000, 3_000, 'airline-A'),
          segment(15_000, 3_000, 'airline-A'),
        ],
        [adult(0), adult(0)],
      );
      expect(price.baggageTotalMinor).toBe(0);
    });

    it('charges zero baggage when the airline does not sell extra bags (price is 0)', () => {
      const price = priceFlightBooking(
        [segment(20_000, 0, 'airline-A'), segment(15_000, 0, 'airline-A')],
        [adult(1), adult(1)],
      );
      expect(price.baggageTotalMinor).toBe(0);
    });
  });
});
