import { BadRequestException } from '@nestjs/common';
import { assertMinor } from '../../common/money/money.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { Converter } from './fx.types.js';

/** What `buildConverter` needs: rates per 1 base unit and each currency's minor units. */
export interface ConverterInput {
  /** 'YYYY-MM-DD' of the rates. */
  rateDate: string;
  rates: Record<string, number>;
  minorUnits: Record<string, number>;
}

/** A rate as an exact fraction of its shortest decimal form (0.7 → 7/10), so no float error creeps in. */
function toFraction(rate: number): { num: bigint; den: bigint } {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(rate));
  if (!match || !(rate > 0)) throw new Error(`Not a valid rate: ${rate}`);
  const [, whole = '', fraction = '', exponent = '0'] = match;
  const shift = Number(exponent) - fraction.length;
  const digits = BigInt(whole + fraction);
  return shift >= 0
    ? { num: digits * 10n ** BigInt(shift), den: 1n }
    : { num: digits, den: 10n ** BigInt(-shift) };
}

/**
 * `amountMinor × rateTo / rateFrom`, adjusted for minor units, rounded half up
 * in exact integer maths (ITN-18). Shared by `buildConverter` and the fake.
 * Throws a plain Error when the result isn't a safe integer.
 */
export function convertMinor(
  amountMinor: number,
  rateFrom: number,
  rateTo: number,
  minorUnitsFrom: number,
  minorUnitsTo: number,
): number {
  assertMinor(amountMinor);
  const from = toFraction(rateFrom);
  const to = toFraction(rateTo);
  // amount × (to.num / to.den) × 10^unitsTo / ((from.num / from.den) × 10^unitsFrom)
  const numerator =
    BigInt(amountMinor) * to.num * from.den * 10n ** BigInt(minorUnitsTo);
  const denominator = to.den * from.num * 10n ** BigInt(minorUnitsFrom);
  const rounded = (2n * numerator + denominator) / (2n * denominator);
  const result = Number(rounded);
  if (BigInt(result) !== rounded) {
    throw new RangeError(`Not a valid amount in minor units: ${rounded}`);
  }
  assertMinor(result);
  return result;
}

/**
 * A pure converter over one set of rates: `amount × rate(to) / rate(from)`,
 * adjusted for each currency's minor units, rounded half up (ITN-18).
 */
export function buildConverter(input: ConverterInput): Converter {
  const { rateDate, rates, minorUnits } = input;

  // Own properties only: 'constructor' or 'toString' are not currencies.
  const assertSupported = (code: string): void => {
    if (!Object.hasOwn(rates, code) || !Object.hasOwn(minorUnits, code)) {
      throw new BadRequestException({
        code: ErrorCode.UnsupportedCurrency,
        message: `Unsupported currency: ${code}`,
      });
    }
  };

  return {
    rateDate,
    convert(amountMinor, from, to) {
      assertMinor(amountMinor);
      assertSupported(from);
      assertSupported(to);
      if (from === to) return amountMinor;
      return convertMinor(
        amountMinor,
        rates[from],
        rates[to],
        minorUnits[from],
        minorUnits[to],
      );
    },
  };
}
