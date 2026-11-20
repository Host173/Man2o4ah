import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { FX_RATES_CLIENT } from './fx-rates.client.js';
import type { FxRatesClient } from './fx-rates.client.js';
import type { ExchangeRatesView } from './fx.types.js';
import { findLatestRates } from './latest-rates.js';
import { ExchangeRate } from './schemas/exchange-rate.schema.js';

/** The base currency every stored document uses: the platform currency. */
export const FX_BASE = 'USD';

export type RefreshResult = 'inserted' | 'exists' | 'failed';

/**
 * Internal to the fx module (not exported): the daily refresh of the cached
 * rates and the read behind `GET /api/exchange-rates/latest` (ITN-18).
 */
@Injectable()
export class FxRatesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FxRatesService.name);

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly exchangeRates: Model<ExchangeRate>,
    private readonly referenceData: ReferenceDataService,
    @Inject(FX_RATES_CLIENT) private readonly client: FxRatesClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Fetches today's rates and stores them. Never throws: on any failure it
   * logs and keeps the old data. The API is called at most once per UTC day.
   */
  async refresh(): Promise<RefreshResult> {
    try {
      const today = toDateOnly(new Date().toISOString().slice(0, 10));
      if (await this.exchangeRates.exists({ rateDate: today })) {
        return 'exists';
      }

      const currencies = await this.referenceData.listCurrencies();
      if (currencies.length === 0) {
        this.logger.warn('No supported currencies; run npm run seed:reference');
        return 'failed';
      }
      const codes = currencies.map(({ code }) => code);

      const fetched = await this.client.fetchLatest(
        FX_BASE,
        codes.filter((code) => code !== FX_BASE),
      );

      const stored = new Map<string, number>([[FX_BASE, 1]]);
      for (const code of codes) {
        if (code === FX_BASE) continue;
        const rate = Object.hasOwn(fetched, code) ? fetched[code] : undefined;
        if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
          throw new Error(`missing or invalid rate for ${code}`);
        }
        stored.set(code, rate);
      }

      await this.exchangeRates.create({
        rateDate: today,
        base: FX_BASE,
        rates: stored,
        fetchedAt: new Date(),
        source: 'fxratesapi',
      });
      return 'inserted';
    } catch (error) {
      // Another refresh won the race for today's document.
      if ((error as { code?: number } | null)?.code === 11000) {
        return 'exists';
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Exchange-rate refresh failed: ${message}`);
      return 'failed';
    }
  }

  /** The newest cached rates; 503 RATES_UNAVAILABLE if none were fetched yet. */
  async latest(): Promise<ExchangeRatesView> {
    const latest = await findLatestRates(this.exchangeRates);
    return {
      base: latest.base,
      rateDate: latest.rateDate,
      fetchedAt: latest.fetchedAt.toISOString(),
      source: latest.source,
      rates: latest.rates,
    };
  }

  /** Start-up never waits for, or fails because of, the API. */
  onApplicationBootstrap(): void {
    if (this.autoRefresh()) void this.refresh();
  }

  @Cron('5 0 * * *', { name: 'fx-daily-refresh', timeZone: 'UTC' })
  async dailyRefresh(): Promise<void> {
    if (this.autoRefresh()) await this.refresh();
  }

  private autoRefresh(): boolean {
    return this.config.get<string>('FX_AUTO_REFRESH') !== 'false';
  }
}
