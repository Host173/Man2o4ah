import {
  REFERENCE_ALPHABET,
  newReservationReference,
} from './booking-reference.js';

describe('newReservationReference (HTL-17)', () => {
  it('is HR followed by 6 characters from the alphabet', () => {
    // Many samples: the format must hold every time, not just once.
    for (let i = 0; i < 1000; i += 1) {
      expect(newReservationReference()).toMatch(
        /^HR[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
      );
    }
  });

  it('fits the reservation schema rule (^HR[A-Z0-9]{6}$)', () => {
    expect(newReservationReference()).toMatch(/^HR[A-Z0-9]{6}$/);
  });

  // The alphabet leaves out look-alikes, so a reference read out on the
  // phone can't be confused (bookings-payments §8).
  it.each(['0', 'O', '1', 'I'])('never uses the look-alike %s', (char) => {
    expect(REFERENCE_ALPHABET).not.toContain(char);
  });

  it('has 32 characters, each once', () => {
    expect(REFERENCE_ALPHABET).toHaveLength(32);
    expect(new Set(REFERENCE_ALPHABET).size).toBe(32);
  });

  // Boundary values of the random pick: the first and last character.
  it('uses the first character when the random pick is always 0', () => {
    expect(newReservationReference(() => 0)).toBe('HRAAAAAA');
  });

  it('uses the last character when the random pick is always the highest', () => {
    expect(newReservationReference((max) => max - 1)).toBe('HR999999');
  });

  it('asks for a pick below the alphabet size, once per character', () => {
    const asked: number[] = [];
    newReservationReference((max) => {
      asked.push(max);
      return 0;
    });
    expect(asked).toEqual([32, 32, 32, 32, 32, 32]);
  });
});
