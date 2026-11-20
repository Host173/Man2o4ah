import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { buildConverter } from './fx-conversion.js';
import type { Converter } from './fx.types.js';
import { findLatestRates } from './latest-rates.js';
import { ExchangeRate } from './schemas/exchange-rate.schema.js';

@Injectable()
export class FxService {
  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly exchangeRates: Model<ExchangeRate>,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * Loads the newest rates once; use it to convert many amounts (budget summaries, ITN-14/18).
   * Throws 503 RATES_UNAVAILABLE if there are no rates.
   */
  async getConverter(): Promise<Converter> {
    const latest = await findLatestRates(this.exchangeRates);
    const currencies = await this.referenceData.listCurrencies();
    const minorUnits = Object.fromEntries(
      currencies.map(({ code, minorUnits: units }) => [code, units]),
    );
    return buildConverter({
      rateDate: latest.rateDate,
      rates: latest.rates,
      minorUnits,
    });
  }

  /** One conversion. Same errors (ITN-18). */
  async convert(
    amountMinor: number,
    from: string,
    to: string,
  ): Promise<{ amountMinor: number; rateDate: string }> {
    const converter = await this.getConverter();
    return {
      amountMinor: converter.convert(amountMinor, from, to),
      rateDate: converter.rateDate,
    };
  }
}
