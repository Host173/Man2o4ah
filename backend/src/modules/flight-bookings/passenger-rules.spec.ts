import { toDateOnly } from '../../common/dates/date-only.js';
import { checkPassengers, passengerTypeOn } from './passenger-rules.js';
import type { RulePassenger, RuleSegment } from './passenger-rules.js';

const travel = toDateOnly('2026-12-01');
/** The day the quote is made (UTC); a date of birth can't be after it. */
const today = toDateOnly('2026-11-17');

describe('passengerTypeOn (FLT-12)', () => {
  // Boundary values: each birthday exactly on the travel date, and one day later.
  it.each([
    ['2024-12-02', 'infant'], // 1 day short of 2 years
    ['2024-12-01', 'child'], // 2nd birthday on the travel date
    ['2014-12-02', 'child'], // 1 day short of 12 years
    ['2014-12-01', 'adult'], // 12th birthday on the travel date
    ['2026-12-01', 'infant'], // born on the travel date
    ['1960-05-20', 'adult'],
  ])('born %s travels as %s on 2026-12-01', (dob, type) => {
    expect(passengerTypeOn(toDateOnly(dob), travel)).toBe(type);
  });

  it('counts a 29 February birthday as reached only on 29 February or 1 March', () => {
    const dob = toDateOnly('2016-02-29');
    expect(passengerTypeOn(dob, toDateOnly('2028-02-28'))).toBe('child'); // 11
    expect(passengerTypeOn(dob, toDateOnly('2028-02-29'))).toBe('adult'); // 12
    expect(passengerTypeOn(dob, toDateOnly('2027-03-01'))).toBe('child'); // 11, not leap
  });
});

const segment = (overrides: Partial<RuleSegment> = {}): RuleSegment => ({
  maxExtraBagsPerPassenger: 2,
  maxBagWeightKg: 23,
  ...overrides,
});

const adult = (overrides: Partial<RulePassenger> = {}): RulePassenger => ({
  type: 'adult',
  dateOfBirth: toDateOnly('1990-01-01'),
  extraBagCount: 0,
  ...overrides,
});
const child = (): RulePassenger =>
  adult({ type: 'child', dateOfBirth: toDateOnly('2018-06-01') });
const infant = (): RulePassenger =>
  adult({ type: 'infant', dateOfBirth: toDateOnly('2026-01-01') });

/** Only the `field`s, so a test reads as "which inputs are wrong". */
const fieldsOf = (
  passengers: RulePassenger[],
  segments: RuleSegment[] = [segment()],
) => checkPassengers(passengers, segments, travel, today).map((e) => e.field);

describe('checkPassengers (FLT-12, FLT-19)', () => {
  it('accepts a valid family', () => {
    expect(fieldsOf([adult(), adult(), child(), infant(), infant()])).toEqual(
      [],
    );
  });

  it('requires at least one adult', () => {
    expect(fieldsOf([child()])).toEqual(['passengers']);
  });

  it('allows as many infants as adults, but not more', () => {
    expect(fieldsOf([adult(), infant()])).toEqual([]);
    expect(fieldsOf([adult(), infant(), infant()])).toEqual(['passengers']);
  });

  it('rejects a type that does not match the age on the travel date', () => {
    const tooOld = adult({ type: 'child' }); // born 1990
    expect(fieldsOf([adult(), tooOld])).toEqual(['passengers[1].type']);
  });

  it('rejects a date of birth after the travel date', () => {
    const unborn = adult({ dateOfBirth: toDateOnly('2026-12-02') });
    expect(fieldsOf([adult(), unborn])).toEqual(['passengers[1].dateOfBirth']);
  });

  it('rejects a date of birth in the future, even before the travel date', () => {
    // Born after today (2026-11-17) but before the flight (2026-12-01).
    const notBornYet = adult({
      type: 'infant',
      dateOfBirth: toDateOnly('2026-11-18'),
    });
    expect(fieldsOf([adult(), notBornYet])).toEqual([
      'passengers[1].dateOfBirth',
    ]);
  });

  it('accepts a baby born today', () => {
    const newborn = adult({ type: 'infant', dateOfBirth: today });
    expect(fieldsOf([adult(), newborn])).toEqual([]);
  });

  it('still checks the other rules when a date of birth is unknown', () => {
    // The service passes no date when the one entered doesn't exist (e.g. 30 February).
    const noDate = adult({ type: 'child', dateOfBirth: undefined });
    expect(fieldsOf([noDate])).toEqual(['passengers']); // no adult
  });

  describe('extra bags (FLT-08, FLT-19)', () => {
    it('allows exactly the maximum and rejects one more', () => {
      const atMax = adult({ extraBagCount: 2, extraBagWeightKg: 20 });
      const overMax = adult({ extraBagCount: 3, extraBagWeightKg: 20 });
      expect(fieldsOf([atMax])).toEqual([]);
      expect(fieldsOf([overMax])).toEqual(['passengers[0].extraBagCount']);
    });

    it('uses the lowest maximum across segments', () => {
      const twoBags = adult({ extraBagCount: 2, extraBagWeightKg: 20 });
      const segments = [segment(), segment({ maxExtraBagsPerPassenger: 1 })];
      expect(fieldsOf([twoBags], segments)).toEqual([
        'passengers[0].extraBagCount',
      ]);
    });

    it('rejects extra bags when an airline sells none', () => {
      const oneBag = adult({ extraBagCount: 1, extraBagWeightKg: 20 });
      expect(
        fieldsOf([oneBag], [segment({ maxExtraBagsPerPassenger: 0 })]),
      ).toEqual(['passengers[0].extraBagCount']);
    });

    it('allows exactly the weight limit and rejects anything heavier', () => {
      const atLimit = adult({ extraBagCount: 1, extraBagWeightKg: 23 });
      const over = adult({ extraBagCount: 1, extraBagWeightKg: 23.1 });
      expect(fieldsOf([atLimit])).toEqual([]);
      expect(fieldsOf([over])).toEqual(['passengers[0].extraBagWeightKg']);
    });

    it('checks a weight sent with no extra bags against the limit', () => {
      const heavyButNoBags = adult({ extraBagCount: 0, extraBagWeightKg: 99 });
      expect(fieldsOf([heavyButNoBags])).toEqual([
        'passengers[0].extraBagWeightKg',
      ]);
    });

    it('allows a weight of 0 when there are no extra bags', () => {
      const defaultZero = adult({ extraBagCount: 0, extraBagWeightKg: 0 });
      expect(fieldsOf([defaultZero])).toEqual([]);
    });

    it('uses the lowest weight limit across segments', () => {
      const heavy = adult({ extraBagCount: 1, extraBagWeightKg: 23 });
      const segments = [segment(), segment({ maxBagWeightKg: 20 })];
      expect(fieldsOf([heavy], segments)).toEqual([
        'passengers[0].extraBagWeightKg',
      ]);
    });

    it('requires a weight when there are extra bags', () => {
      const noWeight = adult({ extraBagCount: 1 });
      expect(fieldsOf([noWeight])).toEqual(['passengers[0].extraBagWeightKg']);
    });
  });

  it('reports every broken rule at once, each with a message', () => {
    const errors = checkPassengers(
      // No adult; the second "child" was born in 1990 and has too many bags and no weight.
      [child(), adult({ type: 'child', extraBagCount: 5 })],
      [segment()],
      travel,
      today,
    );
    expect(errors.map((e) => e.field)).toEqual([
      'passengers',
      'passengers[1].type',
      'passengers[1].extraBagCount',
      'passengers[1].extraBagWeightKg',
    ]);
    for (const error of errors) {
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});
