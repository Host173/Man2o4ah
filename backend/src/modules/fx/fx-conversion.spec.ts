import { BadRequestException } from '@nestjs/common';
import { AmountOverflowError } from '../../common/money/money.js';
import { buildConverter } from './fx-conversion.js';

describe('buildConverter (ITN-18)', () => {
  const rates = { USD: 1, EGP: 50, EUR: 0.9, JPY: 150, AED: 3.6725 };
  const minorUnits = { USD: 2, EGP: 2, EUR: 2, JPY: 0, AED: 2 };
  const converter = buildConverter({
    rateDate: '2026-11-01',
    rates,
    minorUnits,
  });

  it.each([
    [10000, 'USD', 'EGP', 500000, '$100 = 5000 EGP'],
    [500000, 'EGP', 'USD', 10000, 'the reverse'],
    [10000, 'USD', 'JPY', 15000, '$100 = ¥15000, JPY has no minor units'],
    [15000, 'JPY', 'USD', 10000, 'the reverse'],
    [1, 'USD', 'EUR', 1, '0.9 rounds half up to 1'],
    [1, 'EUR', 'USD', 1, '1.111… rounds down to 1'],
    [3, 'EUR', 'EGP', 167, '3 × 50 / 0.9 = 166.67 rounds up'],
    [0, 'USD', 'EGP', 0, 'zero stays zero'],
    [12345, 'EGP', 'EGP', 12345, 'same currency: unchanged, no rounding'],
    [10000, 'USD', 'AED', 36725, 'non-round rate'],
  ])('converts %i %s → %s to %i (%s)', (amount, from, to, expected) => {
    expect(converter.convert(amount, from, to)).toBe(expected);
  });

  it('rounds half up exactly', () => {
    const half = buildConverter({
      rateDate: '2026-11-01',
      rates: { USD: 1, XXX: 0.5 },
      minorUnits: { USD: 2, XXX: 2 },
    });
    expect(half.convert(1, 'USD', 'XXX')).toBe(1);
    expect(half.convert(3, 'USD', 'XXX')).toBe(2);
  });

  it.each([
    [45, 32, '45 × 0.7 = 31.5'],
    [85, 60, '85 × 0.7 = 59.5'],
    [165, 116, '165 × 0.7 = 115.5'],
    [175, 123, '175 × 0.7 = 122.5'],
  ])(
    'rounds an exact .5 half up with a non-integer rate: %i → %i (%s)',
    (amount, expected) => {
      const seventy = buildConverter({
        rateDate: '2026-11-01',
        rates: { USD: 1, XXX: 0.7 },
        minorUnits: { USD: 2, XXX: 2 },
      });
      expect(seventy.convert(amount, 'USD', 'XXX')).toBe(expected);
    },
  );

  it('throws AmountOverflowError when the result is not a safe integer', () => {
    expect(() =>
      converter.convert(Number.MAX_SAFE_INTEGER, 'USD', 'EGP'),
    ).toThrow(AmountOverflowError);
    expect(() =>
      converter.convert(Number.MAX_SAFE_INTEGER, 'USD', 'EGP'),
    ).not.toThrow(BadRequestException);
  });

  it('passes the rate date through unchanged', () => {
    expect(converter.rateDate).toBe('2026-11-01');
  });

  it.each([
    ['from', 'ZZZ', 'USD', 'ZZZ'],
    ['to', 'USD', 'ZZZ', 'ZZZ'],
  ])(
    'rejects an unknown %s code with 400 UNSUPPORTED_CURRENCY',
    (_side, from, to, named) => {
      let caught: unknown;
      try {
        converter.convert(100, from, to);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      const body = (caught as BadRequestException).getResponse();
      expect(body).toMatchObject({ code: 'UNSUPPORTED_CURRENCY' });
      expect(JSON.stringify(body)).toContain(named);
    },
  );

  it('rejects a currency that has a rate but no minor units, and the reverse', () => {
    const noMinor = buildConverter({
      rateDate: '2026-11-01',
      rates: { USD: 1, EGP: 50 },
      minorUnits: { USD: 2 },
    });
    const noRate = buildConverter({
      rateDate: '2026-11-01',
      rates: { USD: 1 },
      minorUnits: { USD: 2, EGP: 2 },
    });
    for (const c of [noMinor, noRate]) {
      expect(() => c.convert(100, 'USD', 'EGP')).toThrow(BadRequestException);
      expect(() => c.convert(100, 'EGP', 'USD')).toThrow(BadRequestException);
    }
  });

  it.each(['constructor', 'toString'])(
    'rejects the inherited property name %s as a currency',
    (name) => {
      expect(() => converter.convert(100, name, 'USD')).toThrow(
        BadRequestException,
      );
      expect(() => converter.convert(100, 'USD', name)).toThrow(
        BadRequestException,
      );
    },
  );

  it.each([-1, 1.5])('throws on the invalid amount %s', (amount) => {
    expect(() => converter.convert(amount, 'USD', 'EGP')).toThrow(Error);
    expect(() => converter.convert(amount, 'USD', 'EGP')).not.toThrow(
      BadRequestException,
    );
  });
});
