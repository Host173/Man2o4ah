import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { FakeFxService } from '../../../test/fakes/fx.fake.js';
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
const RATE_DATE = '2026-11-09';

describe('FxService and FakeFxService agree (ITN-18)', () => {
  let t: TestApp;
  let real: FxService;
  const fake = new FakeFxService({ rates: RATES, rateDate: RATE_DATE });

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FxModule],
      override: (b) =>
        b.overrideProvider(FX_RATES_CLIENT).useValue({ fetchLatest: vi.fn() }),
    });
    await t.moduleRef.get(ReferenceDataSeedService).run();
    const model = t.moduleRef.get<Model<ExchangeRate>>(
      getModelToken(ExchangeRate.name),
    );
    await model.create({
      rateDate: toDateOnly(RATE_DATE),
      base: 'USD',
      rates: new Map(Object.entries(RATES)),
      fetchedAt: new Date(),
      source: 'fxratesapi',
    });
    real = t.moduleRef.get(FxService);
  }, HOOK_TIMEOUT);
  afterAll(() => t.close(), HOOK_TIMEOUT);

  it.each([
    [10000, 'USD', 'EGP'],
    [500000, 'EGP', 'USD'],
    [10000, 'USD', 'JPY'],
    [15000, 'JPY', 'USD'],
    [1, 'USD', 'EUR'],
    [1, 'EUR', 'USD'],
    [3, 'EUR', 'EGP'],
    [0, 'USD', 'EGP'],
    [12345, 'EGP', 'EGP'],
    [10000, 'USD', 'AED'],
    [99999, 'GBP', 'SAR'],
    [777, 'JPY', 'AED'],
  ])('convert(%i, %s, %s) is the same', async (amount, from, to) => {
    await expect(real.convert(amount, from, to)).resolves.toEqual(
      await fake.convert(amount, from, to),
    );
  });

  it('getConverter gives the same date and results', async () => {
    const [a, b] = [await real.getConverter(), await fake.getConverter()];
    expect(a.rateDate).toBe(b.rateDate);
    expect(a.convert(2500, 'EUR', 'JPY')).toBe(b.convert(2500, 'EUR', 'JPY'));
  });
});
