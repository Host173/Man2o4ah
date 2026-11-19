import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ReferenceDataSeedService } from '../reference-data/seed/reference-data-seed.service.js';
import { FX_RATES_CLIENT } from './fx-rates.client.js';
import { FxModule } from './fx.module.js';
import { FxService } from './fx.service.js';
import { ExchangeRate } from './schemas/exchange-rate.schema.js';

const RATES = {
  USD: 1,
  EGP: 50,
  EUR: 0.9,
  JPY: 150,
  AED: 3.6725,
  GBP: 0.8,
  SAR: 3.75,
};

describe('FxService (ITN-18)', () => {
  let t: TestApp;
  let service: FxService;
  let model: Model<ExchangeRate>;

  const store = (rateDate: string, rates: Record<string, number> = RATES) =>
    model.create({
      rateDate: toDateOnly(rateDate),
      base: 'USD',
      rates: new Map(Object.entries(rates)),
      fetchedAt: new Date(),
      source: 'fxratesapi',
    });

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FxModule],
      override: (b) =>
        b.overrideProvider(FX_RATES_CLIENT).useValue({ fetchLatest: vi.fn() }),
    });
    await t.moduleRef.get(ReferenceDataSeedService).run();
    service = t.moduleRef.get(FxService);
    model = t.moduleRef.get(getModelToken(ExchangeRate.name));
  }, HOOK_TIMEOUT);
  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('rejects with 503 RATES_UNAVAILABLE when there are no rates', async () => {
    await expect(service.getConverter()).rejects.toMatchObject({
      status: 503,
      response: { code: 'RATES_UNAVAILABLE' },
    });
    await expect(service.convert(100, 'USD', 'EGP')).rejects.toMatchObject({
      status: 503,
      response: { code: 'RATES_UNAVAILABLE' },
    });
  });

  it('converts with the stored rates and returns their date', async () => {
    await store('2026-11-09');

    await expect(service.convert(10000, 'USD', 'EGP')).resolves.toEqual({
      amountMinor: 500000,
      rateDate: '2026-11-09',
    });
  });

  it('uses the minor units of the currencies table (JPY has none)', async () => {
    await store('2026-11-09');

    const { amountMinor } = await service.convert(10000, 'USD', 'JPY');

    expect(amountMinor).toBe(15000);
  });

  it('uses the newest rateDate when there are several documents', async () => {
    await store('2026-11-08', { ...RATES, EGP: 40 });
    await store('2026-11-10', { ...RATES, EGP: 60 });
    await store('2026-11-09', { ...RATES, EGP: 50 });

    await expect(service.convert(10000, 'USD', 'EGP')).resolves.toEqual({
      amountMinor: 600000,
      rateDate: '2026-11-10',
    });
  });

  it('getConverter loads the rates once for many conversions', async () => {
    await store('2026-11-09');

    const converter = await service.getConverter();

    expect(converter.rateDate).toBe('2026-11-09');
    expect(converter.convert(10000, 'USD', 'EGP')).toBe(500000);
    expect(converter.convert(500000, 'EGP', 'USD')).toBe(10000);
  });

  it('rejects an unknown currency with 400 UNSUPPORTED_CURRENCY', async () => {
    await store('2026-11-09');

    await expect(service.convert(100, 'USD', 'ZZZ')).rejects.toMatchObject({
      status: 400,
      response: { code: 'UNSUPPORTED_CURRENCY' },
    });
    await expect(service.convert(100, 'ZZZ', 'USD')).rejects.toMatchObject({
      status: 400,
      response: { code: 'UNSUPPORTED_CURRENCY' },
    });
  });

  it('rejects a currency that has no stored rate', async () => {
    await store('2026-11-09', { USD: 1, EGP: 50 });

    await expect(service.convert(100, 'USD', 'EUR')).rejects.toMatchObject({
      status: 400,
      response: { code: 'UNSUPPORTED_CURRENCY' },
    });
  });
});
