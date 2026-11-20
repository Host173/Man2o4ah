import {
  REFERENCE_ALPHABET,
  newBookingReference,
} from './booking-reference.js';

// flight-bookings' own copy of the reference rule (DECISIONS §3); the hotel
// copy makes `HR…` references, this one `FB…` (FLT-23, bookings-payments §8).
describe('newBookingReference (FLT-23)', () => {
  it('is FB followed by 6 characters from the alphabet', () => {
    // Many samples: the format must hold every time, not just once.
    for (let i = 0; i < 1000; i += 1) {
      expect(newBookingReference()).toMatch(
        /^FB[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
      );
    }
  });

  it('fits the flight booking schema rule (^FB[A-Z0-9]{6}$)', () => {
    expect(newBookingReference()).toMatch(/^FB[A-Z0-9]{6}$/);
  });

  // No look-alikes, so a reference read out on the phone can't be confused.
  it.each(['0', 'O', '1', 'I'])('never uses the look-alike %s', (char) => {
    expect(REFERENCE_ALPHABET).not.toContain(char);
  });

  it('has 32 characters, each once', () => {
    expect(REFERENCE_ALPHABET).toHaveLength(32);
    expect(new Set(REFERENCE_ALPHABET).size).toBe(32);
  });

  // Boundary values of the random pick: the first and last character.
  it('uses the first character when the random pick is always 0', () => {
    expect(newBookingReference(() => 0)).toBe('FBAAAAAA');
  });

  it('uses the last character when the random pick is always the highest', () => {
    expect(newBookingReference((max) => max - 1)).toBe('FB999999');
  });

  it('asks for a pick below the alphabet size, once per character', () => {
    const asked: number[] = [];
    newBookingReference((max) => {
      asked.push(max);
      return 0;
    });
    expect(asked).toEqual([32, 32, 32, 32, 32, 32]);
  });
});
