/**
 * Refund tiers shared by flight-bookings and hotel-bookings (GEN-11). Lives here
 * until the team leader decides where shared booking rules belong; hotel-bookings
 * imports it from this file.
 */
import { percentOfMinor } from '../../common/money/money.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The fields of a cancellation tier the rule needs (matches `CancellationTier`). */
export interface RefundTier {
  daysBefore: number;
  refundPercent: number;
}

export interface RefundResult {
  percent: number;
  amountMinor: number;
}

/**
 * The refund for cancelling at `now` (FLT-09, HTL-10, GEN-11). `start` is the
 * outbound departure (flights) or the check-in date at 00:00 UTC (hotels).
 * Uses the tier with the largest `daysBefore` not above the full days left;
 * none fits → 0%. Pass the booking's snapshot tiers, never the provider's current ones.
 */
export function refundFor(
  tiers: readonly RefundTier[],
  totalMinor: number,
  start: Date,
  now: Date,
): RefundResult {
  const msLeft = start.getTime() - now.getTime();
  if (msLeft < 0) {
    return { percent: 0, amountMinor: 0 };
  }
  const daysLeft = Math.floor(msLeft / DAY_MS);

  let best: RefundTier | undefined;
  for (const tier of tiers) {
    if (
      tier.daysBefore <= daysLeft &&
      (best === undefined || tier.daysBefore > best.daysBefore)
    ) {
      best = tier;
    }
  }

  const percent = best?.refundPercent ?? 0;
  return { percent, amountMinor: percentOfMinor(totalMinor, percent) };
}
