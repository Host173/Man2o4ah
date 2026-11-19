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
      return Math.round(
        (amountMinor * rates[to] * 10 ** minorUnits[to]) /
          (rates[from] * 10 ** minorUnits[from]),
      );
    },
  };
}
