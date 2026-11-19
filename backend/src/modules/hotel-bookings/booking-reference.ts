import { randomInt } from 'node:crypto';

/** 32 characters with no look-alikes (no 0/O, no 1/I), bookings-payments §8. */
export const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A reservation reference like `HRK7QM2X` (HTL-17). `pick` is for tests; it defaults to crypto's randomInt. */
export function newReservationReference(
  pick: (max: number) => number = randomInt,
): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += REFERENCE_ALPHABET[pick(REFERENCE_ALPHABET.length)];
  }
  return `HR${code}`;
}
