import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type { Converter } from '../../src/modules/fx/fx.types.js';
import type { FxService } from '../../src/modules/fx/fx.service.js';
import type { PublicApi } from './public-api.js';

export interface FakeFxOptions {
  /** Rates per 1 USD, by currency code. */
  rates?: Record<string, number>;
  /** Minor units by currency code; a code that isn't listed has 2. */
  minorUnits?: Record<string, number>;
  rateDate?: string;
}

const DEFAULT_RATES: Record<string, number> = {
  USD: 1,
  EGP: 50,
  EUR: 0.9,
  AED: 3.6725,
  JPY: 150,
};

/** A working `FxService` with fixed rates: `amount × rate(to) / rate(from)`, adjusted for minor units, rounded half up. */
export class FakeFxService implements PublicApi<FxService> {
  private readonly rates: Record<string, number>;
  private readonly minorUnits: Record<string, number>;
  private readonly rateDate: string;
  private noRates = false;

  constructor(options: FakeFxOptions = {}) {
    this.rates = options.rates ?? DEFAULT_RATES;
    this.minorUnits = { JPY: 0, ...options.minorUnits };
    this.rateDate = options.rateDate ?? '2026-11-01';
  }

  /** Makes `getConverter` and `convert` fail with 503 RATES_UNAVAILABLE. */
  setNoRates(): void {
    this.noRates = true;
  }

  // async: both methods reject the promise when there are no rates.
  async getConverter(): Promise<Converter> {
    this.assertRates();
    return {
      rateDate: this.rateDate,
      convert: (amountMinor, from, to) => this.calculate(amountMinor, from, to),
    };
  }

  async convert(
    amountMinor: number,
    from: string,
    to: string,
  ): Promise<{ amountMinor: number; rateDate: string }> {
    this.assertRates();
    return {
      amountMinor: this.calculate(amountMinor, from, to),
      rateDate: this.rateDate,
    };
  }

  private assertRates(): void {
    if (this.noRates) {
      throw new ServiceUnavailableException({
        code: ErrorCode.RatesUnavailable,
        message: 'Exchange rates are unavailable',
      });
    }
  }

  private calculate(amountMinor: number, from: string, to: string): number {
    const rateFrom = this.rates[from];
    const rateTo = this.rates[to];
    if (rateFrom === undefined || rateTo === undefined) {
      throw new BadRequestException({
        code: ErrorCode.UnsupportedCurrency,
        message: `Unsupported currency: ${rateFrom === undefined ? from : to}`,
      });
    }
    const unitsFrom = 10 ** (this.minorUnits[from] ?? 2);
    const unitsTo = 10 ** (this.minorUnits[to] ?? 2);
    return Math.round(
      (amountMinor * rateTo * unitsTo) / (rateFrom * unitsFrom),
    );
  }
}
