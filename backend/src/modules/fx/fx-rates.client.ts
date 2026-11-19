import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Fetches the latest rates per 1 `base`; throws on any failure (FxRatesService catches). */
export interface FxRatesClient {
  fetchLatest(
    base: string,
    currencies: string[],
  ): Promise<Record<string, number>>;
}

export const FX_RATES_CLIENT = Symbol('FX_RATES_CLIENT');

const FXRATES_LATEST_URL = 'https://api.fxratesapi.com/latest';
const TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The FXRatesAPI adapter (ITN-18). Tests replace it through `FX_RATES_CLIENT`.
 * The request URL can contain the API key, so it is never put in an error or a log.
 */
@Injectable()
export class FxRatesApiClient implements FxRatesClient {
  constructor(private readonly config: ConfigService) {}

  async fetchLatest(
    base: string,
    currencies: string[],
  ): Promise<Record<string, number>> {
    const params = new URLSearchParams({
      base,
      currencies: currencies.join(','),
    });
    const apiKey = this.config.get<string>('FXRATES_API_KEY');
    if (typeof apiKey === 'string' && apiKey !== '') {
      params.set('api_key', apiKey);
    }

    const res = await fetch(`${FXRATES_LATEST_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`FXRatesAPI answered ${res.status}`);
    }

    const body: unknown = await res.json();
    if (!isRecord(body) || body.success === false || !isRecord(body.rates)) {
      const description = isRecord(body) ? body.description : undefined;
      throw new Error(
        `FXRatesAPI error: ${typeof description === 'string' ? description : 'unexpected response'}`,
      );
    }

    const rates: Record<string, number> = {};
    for (const [code, value] of Object.entries(body.rates)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        rates[code] = value;
      }
    }
    return rates;
  }
}
