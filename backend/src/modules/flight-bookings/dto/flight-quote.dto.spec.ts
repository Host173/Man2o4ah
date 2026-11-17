import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ValidationError } from 'class-validator';
import { FlightQuoteRequestDto } from './flight-quote.dto.js';

const passenger = {
  type: 'adult',
  fullName: 'Aya Amr',
  dateOfBirth: '1990-01-01',
  documentNumber: 'A12345678',
  extraBagCount: 1,
  extraBagWeightKg: 20,
};

const valid = {
  tripType: 'one_way',
  segments: [
    {
      flightId: '6553a1f0c2b4e8a9d0f1a234',
      cabinId: '6553a1f0c2b4e8a9d0f1a235',
    },
  ],
  passengers: [passenger],
};

/** Flattens nested errors into paths like `passengers.0.fullName`. */
function paths(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix + error.property;
    return error.children?.length ? paths(error.children, `${path}.`) : [path];
  });
}

/** Runs the same steps as the global ValidationPipe: transform, then validate. */
async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(FlightQuoteRequestDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, failed: paths(errors) };
}

const withPassenger = (changes: Record<string, unknown>) => ({
  ...valid,
  passengers: [{ ...passenger, ...changes }],
});

describe('FlightQuoteRequestDto (FLT-19)', () => {
  it('accepts a valid one-way body', async () => {
    expect((await check(valid)).failed).toEqual([]);
  });

  it('accepts a round trip with two segments', async () => {
    const roundTrip = {
      ...valid,
      tripType: 'round_trip',
      segments: [valid.segments[0], valid.segments[0]],
    };
    expect((await check(roundTrip)).failed).toEqual([]);
  });

  it('rejects an unknown trip type', async () => {
    expect((await check({ ...valid, tripType: 'one-way' })).failed).toEqual([
      'tripType',
    ]);
  });

  describe('segments (1 or 2)', () => {
    it.each([
      [0, ['segments']],
      [1, []],
      [2, []],
      [3, ['segments']],
    ])('%i segments → errors %j', async (count, expected) => {
      const segments = Array.from({ length: count }, () => valid.segments[0]);
      expect((await check({ ...valid, segments })).failed).toEqual(expected);
    });

    it('rejects an id that is not a Mongo id', async () => {
      const segments = [{ ...valid.segments[0], cabinId: 'cabin-1' }];
      expect((await check({ ...valid, segments })).failed).toEqual([
        'segments.0.cabinId',
      ]);
    });
  });

  it('requires at least one passenger', async () => {
    expect((await check({ ...valid, passengers: [] })).failed).toEqual([
      'passengers',
    ]);
  });

  // The test that proves @ValidateNested + @Type really check inside the array.
  it('validates fields inside each passenger', async () => {
    expect((await check(withPassenger({ type: 'pilot' }))).failed).toEqual([
      'passengers.0.type',
    ]);
  });

  describe('fullName (1-100 characters after trimming)', () => {
    it.each([
      ['', ['passengers.0.fullName']],
      ['   ', ['passengers.0.fullName']],
      ['A', []],
      ['A'.repeat(100), []],
      ['A'.repeat(101), ['passengers.0.fullName']],
    ])('%j → errors %j', async (fullName, expected) => {
      expect((await check(withPassenger({ fullName }))).failed).toEqual(
        expected,
      );
    });

    it('trims the name', async () => {
      const { dto } = await check(withPassenger({ fullName: '  Aya Amr  ' }));
      expect(dto.passengers[0].fullName).toBe('Aya Amr');
    });
  });

  describe('documentNumber (3-30 characters after trimming)', () => {
    it.each([
      ['AB', ['passengers.0.documentNumber']],
      ['ABC', []],
      ['A'.repeat(30), []],
      ['A'.repeat(31), ['passengers.0.documentNumber']],
    ])('%j → errors %j', async (documentNumber, expected) => {
      expect((await check(withPassenger({ documentNumber }))).failed).toEqual(
        expected,
      );
    });
  });

  it.each(['01-01-1990', '1990/01/01', '1990-1-1'])(
    'rejects the date of birth %j',
    async (dateOfBirth) => {
      expect((await check(withPassenger({ dateOfBirth }))).failed).toEqual([
        'passengers.0.dateOfBirth',
      ]);
    },
  );

  describe('extra bags', () => {
    it.each([
      [-1, ['passengers.0.extraBagCount']],
      [0, []],
      [1.5, ['passengers.0.extraBagCount']],
    ])('extraBagCount %d → errors %j', async (extraBagCount, expected) => {
      expect((await check(withPassenger({ extraBagCount }))).failed).toEqual(
        expected,
      );
    });

    it('allows leaving out the weight', async () => {
      const body = withPassenger({ extraBagCount: 0 });
      delete (body.passengers[0] as Record<string, unknown>).extraBagWeightKg;
      expect((await check(body)).failed).toEqual([]);
    });

    it('allows a weight of 0, a form default (the rules require > 0 only with bags)', async () => {
      const body = withPassenger({ extraBagCount: 0, extraBagWeightKg: 0 });
      expect((await check(body)).failed).toEqual([]);
    });

    it('rejects a negative weight', async () => {
      expect(
        (await check(withPassenger({ extraBagWeightKg: -5 }))).failed,
      ).toEqual(['passengers.0.extraBagWeightKg']);
    });
  });

  it('rejects fields the client must not send (GEN-13)', async () => {
    expect((await check({ ...valid, totalMinor: 1 })).failed).toEqual([
      'totalMinor',
    ]);
  });
});
