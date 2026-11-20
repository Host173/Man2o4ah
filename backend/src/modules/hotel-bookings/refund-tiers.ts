import { percentOfMinor } from '../../common/money/money.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RefundTier {
  daysBefore: number;
  refundPercent: number;
}

export interface RefundResult {
  percent: number;
  amountMinor: number;
}

/**
 * HTL-10, HTL-21: the largest snapshot threshold not above the full days until
 * check-in at midnight UTC. GEN-11's flight copy follows the same selection rule;
 * the booking modules do not import each other (DECISIONS section 3).
 */
export function refundFor(
  tiers: readonly RefundTier[],
  totalMinor: number,
  start: Date,
  now: Date,
): RefundResult {
  if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) {
    throw new Error('refundFor needs a valid start and now');
  }
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
