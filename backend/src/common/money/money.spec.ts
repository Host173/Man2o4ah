import {
  AmountOverflowError,
  assertMinor,
  multiplyMinor,
  percentOfMinor,
  sumMinor,
} from './money.js';

describe('money helpers', () => {
  it('sumMinor and multiplyMinor throw AmountOverflowError when the result is too large', () => {
    expect(() =>
      sumMinor(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    ).toThrow(AmountOverflowError);
    expect(() => multiplyMinor(Number.MAX_SAFE_INTEGER, 2)).toThrow(
      AmountOverflowError,
    );
  });

  it('bad input is a plain Error, not AmountOverflowError', () => {
    for (const run of [() => sumMinor(-1), () => multiplyMinor(1.5, 2)]) {
      expect(run).toThrow(Error);
      expect(run).not.toThrow(AmountOverflowError);
    }
  });

  it('percentOfMinor rounds half up', () => {
    expect(percentOfMinor(15, 10)).toBe(2);
    expect(percentOfMinor(14, 10)).toBe(1);
    expect(percentOfMinor(0, 50)).toBe(0);
  });

  it('percentOfMinor rejects a percent outside 0..100', () => {
    expect(() => percentOfMinor(100, 101)).toThrow();
    expect(() => percentOfMinor(100, -1)).toThrow();
  });

  it('sumMinor adds amounts', () => {
    expect(sumMinor(1999, 500, 1)).toBe(2500);
    expect(sumMinor()).toBe(0);
  });

  it('sumMinor rejects an invalid amount', () => {
    expect(() => sumMinor(100, 1.5)).toThrow();
  });

  it('multiplyMinor multiplies by a whole quantity', () => {
    expect(multiplyMinor(1999, 3)).toBe(5997);
    expect(multiplyMinor(1999, 0)).toBe(0);
  });

  it('multiplyMinor rejects a bad quantity', () => {
    expect(() => multiplyMinor(100, -1)).toThrow();
    expect(() => multiplyMinor(100, 1.5)).toThrow();
  });

  it('assertMinor throws for 1.5, -1 and NaN', () => {
    expect(() => assertMinor(1.5)).toThrow();
    expect(() => assertMinor(-1)).toThrow();
    expect(() => assertMinor(NaN)).toThrow();
  });

  it('assertMinor accepts 0 and a normal amount', () => {
    expect(() => assertMinor(0)).not.toThrow();
    expect(() => assertMinor(1999)).not.toThrow();
  });
});
