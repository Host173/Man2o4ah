/**
 * Money is an integer number of minor units (1999 = $19.99).
 * A bad amount is a programming error, not a client error, so these throw a
 * plain Error (the global filter turns it into a 500).
 */
export function assertMinor(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`Not a valid amount in minor units: ${n}`);
  }
}

export function sumMinor(...amounts: number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertMinor(amount);
    total += amount;
  }
  assertMinor(total);
  return total;
}

export function multiplyMinor(amountMinor: number, quantity: number): number {
  assertMinor(amountMinor);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error(`Not a valid quantity: ${quantity}`);
  }
  const result = amountMinor * quantity;
  assertMinor(result);
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
