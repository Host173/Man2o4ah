import { quoteFlightChange, splitCancellationRefund } from './flight-change.js';
import type { ChangeSegment } from './flight-change.js';
import type { PricedPassenger } from './flight-pricing.js';

const adult = (extraBagCount = 0): PricedPassenger => ({
  type: 'adult',
  extraBagCount,
});

const outbound = (
  fareMinor: number,
  extraBagPriceMinor = 0,
  airlineId = 'airline-A',
): ChangeSegment => ({
  direction: 'outbound',
  airlineId,
  fareMinor,
  extraBagPriceMinor,
});

const inbound = (
  fareMinor: number,
  extraBagPriceMinor = 0,
  airlineId = 'airline-A',
): ChangeSegment => ({
  direction: 'return',
  airlineId,
  fareMinor,
  extraBagPriceMinor,
});

describe('quoteFlightChange (FLT-27)', () => {
  it('asks the user to pay the difference when the new fare is higher', () => {
    const quote = quoteFlightChange(
      [outbound(20_000)],
      [adult(), adult()],
      40_000,
      outbound(25_000),
    );
    expect(quote.differenceMinor).toBe(10_000); // 2 × 25 000 − 40 000
    expect(quote.newPrice.totalMinor).toBe(50_000);
  });

  it('returns a negative difference (a refund) when the new fare is lower', () => {
    const quote = quoteFlightChange(
      [outbound(20_000)],
      [adult()],
      20_000,
      outbound(15_000),
    );
    expect(quote.differenceMinor).toBe(-5_000);
  });

  it('returns 0 when the new fare is the same', () => {
    const quote = quoteFlightChange(
      [outbound(20_000)],
      [adult()],
      20_000,
      outbound(20_000),
    );
    expect(quote.differenceMinor).toBe(0);
  });

  it('replaces only the chosen direction of a round trip', () => {
    const quote = quoteFlightChange(
      [outbound(20_000), inbound(15_000)],
      [adult()],
      35_000,
      inbound(18_000),
    );
    expect(quote.newPrice.fareTotalMinor).toBe(20_000 + 18_000);
    expect(quote.differenceMinor).toBe(3_000);
  });

  it('reprices baggage when the new flight is on another airline (fee charged once per airline)', () => {
    // Before: both legs on airline A, bag 3 000 → baggage 3 000 once.
    // After: return moves to airline B, bag 4 000 → baggage 3 000 + 4 000.
    const quote = quoteFlightChange(
      [outbound(20_000, 3_000), inbound(15_000, 3_000)],
      [adult(1)],
      20_000 + 15_000 + 3_000,
      inbound(15_000, 4_000, 'airline-B'),
    );
    expect(quote.newPrice.baggageTotalMinor).toBe(7_000);
    expect(quote.differenceMinor).toBe(4_000);
  });

  it('throws if the booking has no segment in that direction', () => {
    expect(() =>
      quoteFlightChange([outbound(20_000)], [adult()], 20_000, inbound(10_000)),
    ).toThrow(/return/);
  });
});

describe('splitCancellationRefund (FLT-27)', () => {
  it('takes the whole refund from the first payment when no change was paid', () => {
    expect(splitCancellationRefund(25_000, 50, 0)).toEqual({
      firstPaymentMinor: 25_000,
      changePaymentMinor: 0,
    });
  });

  it('refunds the paid change by the same percent and the rest from the first payment', () => {
    // Booking 40 000 + paid change 10 000 = 50 000; 50% = 25 000.
    expect(splitCancellationRefund(25_000, 50, 10_000)).toEqual({
      firstPaymentMinor: 20_000,
      changePaymentMinor: 5_000,
    });
  });

  it('refunds both payments in full at 100% (provider cancellation)', () => {
    expect(splitCancellationRefund(50_000, 100, 10_000)).toEqual({
      firstPaymentMinor: 40_000,
      changePaymentMinor: 10_000,
    });
  });

  it('rounds the change part half up and keeps the total exact', () => {
    // 50% of 10 001 is 5 000.5 → 5 001; the first payment gets the rest.
    const split = splitCancellationRefund(25_001, 50, 10_001);
    expect(split.changePaymentMinor).toBe(5_001);
    expect(split.firstPaymentMinor + split.changePaymentMinor).toBe(25_001);
  });

  it('refunds nothing from either payment at 0%', () => {
    expect(splitCancellationRefund(0, 0, 10_000)).toEqual({
      firstPaymentMinor: 0,
      changePaymentMinor: 0,
    });
  });
});
