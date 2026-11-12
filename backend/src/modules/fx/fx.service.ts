import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Converter } from './fx.types.js';

@Injectable()
export class FxService {
  /**
   * Loads the newest rates once; use it to convert many amounts (budget summaries, ITN-14/18).
   * Throws 503 RATES_UNAVAILABLE if there are no rates. Implemented in ITN-18.
   */
  getConverter(): Promise<Converter> {
    throw new NotImplementedException('getConverter: implemented in ITN-18');
  }

  /** One conversion. Same errors (ITN-18). Implemented in ITN-18. */
  convert(
    amountMinor: number,
    from: string,
    to: string,
  ): Promise<{ amountMinor: number; rateDate: string }> {
    void amountMinor;
    void from;
    void to;
    throw new NotImplementedException('convert: implemented in ITN-18');
  }
}
