/**
 * The refund tier rule (FLT-09) for flight bookings. hotel-bookings has its own
 * copy (HTL-10) that must follow the same rule; neither module imports the
 * other (DECISIONS.md §3, booking rules per module).
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
  // An invalid date would make every comparison false and silently refund 0%.
  if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) {
    throw new Error('refundFor needs a valid start and now');
  }
  // After the start this is negative, so no tier matches and the refund is 0%.
  const daysLeft = Math.floor((start.getTime() - now.getTime()) / DAY_MS);

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
