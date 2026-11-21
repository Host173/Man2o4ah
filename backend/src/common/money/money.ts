/**
 * Money is an integer number of minor units (1999 = $19.99).
 * A bad amount is a programming error, not a client error, so these throw a
 * plain Error (the global filter turns it into a 500). A valid input whose
 * result is too large to represent throws AmountOverflowError (a 400).
 */

/** Most one priced unit (a seat, a room night, an extra bag) may cost: $100,000.00. */
export const MAX_PRICE_MINOR = 10_000_000;
/** Most one booking may total: Stripe's per-charge maximum ($999,999.99). */
export const MAX_BOOKING_TOTAL_MINOR = 99_999_999;
/** Most one itinerary amount may be, in its own currency's minor units. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

/** Valid amounts whose result is not a safe integer. */
export class AmountOverflowError extends Error {
  override name = 'AmountOverflowError';
}

export function assertMinor(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`Not a valid amount in minor units: ${n}`);
  }
}

/** assertMinor, except a finite amount past the safe range is an overflow (a 400), not bad input. */
export function assertMinorFits(n: number): void {
  if (Number.isFinite(n) && n > Number.MAX_SAFE_INTEGER) {
    throw new AmountOverflowError(`Amount too large: ${n}`);
  }
  assertMinor(n);
}

export function sumMinor(...amounts: number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertMinor(amount);
    total += amount;
  }
  if (!Number.isSafeInteger(total)) {
    throw new AmountOverflowError(`Amount too large: ${total}`);
  }
  return total;
}

export function multiplyMinor(amountMinor: number, quantity: number): number {
  assertMinor(amountMinor);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error(`Not a valid quantity: ${quantity}`);
  }
  const result = amountMinor * quantity;
  if (!Number.isSafeInteger(result)) {
    throw new AmountOverflowError(`Amount too large: ${result}`);
  }
  return result;
}

/** `percent` of an amount, rounded half up (used for the infant 10% and refund tiers). */
export function percentOfMinor(amountMinor: number, percent: number): number {
  assertMinor(amountMinor);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`Not a valid percent: ${percent}`);
  }
  return Math.round((amountMinor * percent) / 100);
}
