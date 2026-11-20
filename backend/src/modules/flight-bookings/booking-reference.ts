import { randomInt } from 'node:crypto';

/** 32 characters with no look-alikes (no 0/O, no 1/I), bookings-payments §8. */
export const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A flight booking reference like `FBK7QM2X` (FLT-23). flight-bookings' own copy
 * of the reference rule; hotel-bookings has the `HR…` one (DECISIONS §3).
 * `pick` is for tests; it defaults to crypto's randomInt.
 */
export function newBookingReference(
  pick: (max: number) => number = randomInt,
): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += REFERENCE_ALPHABET[pick(REFERENCE_ALPHABET.length)];
  }
  return `FB${code}`;
}
