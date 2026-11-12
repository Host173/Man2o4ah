/** Converts many amounts with one set of loaded rates (ITN-14, ITN-18). */
export interface Converter {
  /** 'YYYY-MM-DD' of the rates used. */
  rateDate: string;
  /** Converts an amount in minor units; rounds half up. Throws 400 UNSUPPORTED_CURRENCY for an unknown code (ITN-18). */
  convert(amountMinor: number, from: string, to: string): number;
}
