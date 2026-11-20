import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Model } from 'mongoose';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ReferenceDataSeedService } from '../reference-data/seed/reference-data-seed.service.js';
import { FX_RATES_CLIENT, type FxRatesClient } from './fx-rates.client.js';
import { FxRatesService } from './fx-rates.service.js';
import { FxModule } from './fx.module.js';
import { ExchangeRate } from './schemas/exchange-rate.schema.js';

describe('Exchange rates HTTP API (ITN-18)', () => {
  let t: TestApp;
  let model: Model<ExchangeRate>;
  const client = { fetchLatest: vi.fn<FxRatesClient['fetchLatest']>() };

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FxModule],
      override: (b) => b.overrideProvider(FX_RATES_CLIENT).useValue(client),
    });
    await t.moduleRef.get(ReferenceDataSeedService).run();
    model = t.moduleRef.get(getModelToken(ExchangeRate.name));
  }, HOOK_TIMEOUT);
  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    client.fetchLatest.mockReset();
    await model.deleteMany({});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers 503 RATES_UNAVAILABLE when no rates were fetched yet', async () => {
    const res = await t.http().get('/api/exchange-rates/latest').expect(503);
    expect(res.body.code).toBe(ErrorCode.RatesUnavailable);
  });

  it('returns the latest rates to anyone, no login needed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    client.fetchLatest.mockResolvedValue({
      AED: 3.6725,
      EGP: 50,
      EUR: 0.9,
      GBP: 0.8,
      JPY: 150,
      SAR: 3.75,
    });
    await expect(t.moduleRef.get(FxRatesService).refresh()).resolves.toBe(
      'inserted',
    );

    const res = await t.http().get('/api/exchange-rates/latest').expect(200);

    expect(res.body).toEqual({
      base: 'USD',
      rateDate: '2026-11-10',
      fetchedAt: '2026-11-10T12:00:00.000Z',
      source: 'fxratesapi',
      rates: {
        AED: 3.6725,
        EGP: 50,
        EUR: 0.9,
        GBP: 0.8,
        JPY: 150,
        SAR: 3.75,
        USD: 1,
      },
    });
    expect(Object.keys(res.body.rates)).toEqual([
      'AED',
      'EGP',
      'EUR',
      'GBP',
      'JPY',
      'SAR',
      'USD',
    ]);
  });

  it('registers the path in Swagger', () => {
    const doc = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operation = doc.paths['/api/exchange-rates/latest']?.get;
    expect(operation).toBeDefined();
    expect(operation?.summary).toContain('ITN-18');
  });
});
