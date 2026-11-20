import { ServiceUnavailableException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { ExchangeRate } from './schemas/exchange-rate.schema.js';

/** The newest stored rates in plain form (internal to the fx module). */
export interface LatestRates {
  /** 'YYYY-MM-DD' */
  rateDate: string;
  base: string;
  fetchedAt: Date;
  source: string;
  /** Per 1 `base`, keys sorted by code. */
  rates: Record<string, number>;
}

/** Loads the document with the newest `rateDate`; 503 RATES_UNAVAILABLE when there is none. */
export async function findLatestRates(
  model: Model<ExchangeRate>,
): Promise<LatestRates> {
  const doc = await model.findOne().sort({ rateDate: -1 }).lean<ExchangeRate>();
  if (!doc) {
    throw new ServiceUnavailableException({
      code: ErrorCode.RatesUnavailable,
      message: 'Exchange rates are unavailable',
    });
  }
  // A lean Map field can come back as a plain object or as a Map.
  const raw: Record<string, number> =
    doc.rates instanceof Map ? Object.fromEntries(doc.rates) : doc.rates;
  const rates = Object.fromEntries(
    Object.entries(raw).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return {
    rateDate: doc.rateDate.toISOString().slice(0, 10),
    base: doc.base,
    fetchedAt: doc.fetchedAt,
    source: doc.source,
    rates,
  };
}
