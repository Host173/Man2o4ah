/** Converts many amounts with one set of loaded rates (ITN-14, ITN-18). */
export interface Converter {
  /** 'YYYY-MM-DD' of the rates used. */
  rateDate: string;
  /** Converts an amount in minor units; rounds half up. Throws 400 UNSUPPORTED_CURRENCY for an unknown code (ITN-18). */
  convert(amountMinor: number, from: string, to: string): number;
}

/** The latest cached rates as `GET /api/exchange-rates/latest` returns them (ITN-18). */
export interface ExchangeRatesView {
  /** The currency every rate is relative to (1 `base` = `rates[code]` of that currency). */
  base: string;
  /** 'YYYY-MM-DD' of the rates. */
  rateDate: string;
  /** ISO timestamp of the fetch. */
  fetchedAt: string;
  source: string;
  /** Per 1 `base`, keys sorted by code. */
  rates: Record<string, number>;
}
