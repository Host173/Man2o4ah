import type { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { ReferenceDataSeedService } from '../reference-data/seed/reference-data-seed.service.js';
import { FX_RATES_CLIENT, type FxRatesClient } from './fx-rates.client.js';
import { FxRatesService } from './fx-rates.service.js';
import { FxModule } from './fx.module.js';
import { FxService } from './fx.service.js';
import { ExchangeRate } from './schemas/exchange-rate.schema.js';

const goodAnswer = () => ({
  AED: 3.6725,
  EGP: 50,
  EUR: 0.9,
  GBP: 0.8,
  JPY: 150,
  SAR: 3.75,
});

describe('FxRatesService (ITN-18)', () => {
  let t: TestApp;
  let service: FxRatesService;
  let model: Model<ExchangeRate>;
  const client = { fetchLatest: vi.fn<FxRatesClient['fetchLatest']>() };

  const today = '2026-11-10';
  const setToday = (iso = `${today}T12:00:00.000Z`) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FxModule],
      override: (b) => b.overrideProvider(FX_RATES_CLIENT).useValue(client),
    });
    await t.moduleRef.get(ReferenceDataSeedService).run();
    service = t.moduleRef.get(FxRatesService);
    model = t.moduleRef.get(getModelToken(ExchangeRate.name));
  }, HOOK_TIMEOUT);
  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    client.fetchLatest.mockReset();
    await model.deleteMany({});
    setToday();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('inserts the first refresh with every supported currency', async () => {
    client.fetchLatest.mockResolvedValue(goodAnswer());

    await expect(service.refresh()).resolves.toBe('inserted');

    expect(client.fetchLatest).toHaveBeenCalledTimes(1);
    expect(client.fetchLatest).toHaveBeenCalledWith('USD', [
      'AED',
      'EGP',
      'EUR',
      'GBP',
      'JPY',
      'SAR',
    ]);
    const docs = await model.find().lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].rateDate.toISOString()).toBe(`${today}T00:00:00.000Z`);
    expect(docs[0].base).toBe('USD');
    expect(docs[0].source).toBe('fxratesapi');
    const rates = new Map(Object.entries(docs[0].rates));
    expect(rates.size).toBe(7);
    expect(rates.get('USD')).toBe(1);
    expect(rates.get('EGP')).toBe(50);
  });

  it('calls the API at most once a day', async () => {
    client.fetchLatest.mockResolvedValue(goodAnswer());
    await service.refresh();

    await expect(service.refresh()).resolves.toBe('exists');

    expect(client.fetchLatest).toHaveBeenCalledTimes(1);
    await expect(model.countDocuments()).resolves.toBe(1);
  });

  it('inserts a new document the next day', async () => {
    client.fetchLatest.mockResolvedValue(goodAnswer());
    await service.refresh();

    setToday('2026-11-11T12:00:00.000Z');

    await expect(service.refresh()).resolves.toBe('inserted');
    await expect(model.countDocuments()).resolves.toBe(2);
  });

  it('keeps the old rates when the API fails', async () => {
    client.fetchLatest.mockResolvedValue(goodAnswer());
    setToday('2026-11-09T12:00:00.000Z');
    await service.refresh();
    setToday();
    client.fetchLatest.mockRejectedValue(new Error('network down'));

    await expect(service.refresh()).resolves.toBe('failed');

    await expect(model.countDocuments()).resolves.toBe(1);
    const converter = await t.moduleRef.get(FxService).getConverter();
    expect(converter.rateDate).toBe('2026-11-09');
  });

  it.each([
    ['a missing SAR', () => ({ ...goodAnswer(), SAR: undefined })],
    ['EGP of 0', () => ({ ...goodAnswer(), EGP: 0 })],
    ['EGP of -1', () => ({ ...goodAnswer(), EGP: -1 })],
    ['EGP that is not finite', () => ({ ...goodAnswer(), EGP: Infinity })],
  ])('stores nothing for a bad answer with %s', async (_name, answer) => {
    client.fetchLatest.mockResolvedValue(answer() as Record<string, number>);

    await expect(service.refresh()).resolves.toBe('failed');

    await expect(model.countDocuments()).resolves.toBe(0);
  });

  it('ignores currencies the platform does not support', async () => {
    client.fetchLatest.mockResolvedValue({ ...goodAnswer(), CHF: 0.88 });

    await expect(service.refresh()).resolves.toBe('inserted');

    const doc = await model.findOne().lean();
    expect(Object.keys(doc?.rates ?? {})).not.toContain('CHF');
  });

  it('fails without calling the API when there are no currencies', async () => {
    const currencies = t.connection.collection('currencies');
    const saved = await currencies.find().toArray();
    await currencies.deleteMany({});
    try {
      await expect(service.refresh()).resolves.toBe('failed');
      expect(client.fetchLatest).not.toHaveBeenCalled();
    } finally {
      await currencies.insertMany(saved);
    }
  });

  it('stores one document when two refreshes race', async () => {
    client.fetchLatest.mockResolvedValue(goodAnswer());

    const results = await Promise.all([service.refresh(), service.refresh()]);

    for (const result of results) {
      expect(['inserted', 'exists']).toContain(result);
    }
    expect(results).toContain('inserted');
    await expect(model.countDocuments()).resolves.toBe(1);
  });

  it('never throws, even when the database read fails', async () => {
    const spy = vi.spyOn(model, 'exists').mockImplementation(() => {
      throw new Error('db down');
    });
    try {
      await expect(service.refresh()).resolves.toBe('failed');
    } finally {
      spy.mockRestore();
    }
  });

  describe('start-up and the daily job', () => {
    const withFlag = (flag: string | undefined) =>
      new FxRatesService(model, t.moduleRef.get(ReferenceDataService), client, {
        get: () => flag,
      } as unknown as ConfigService);

    it('does not fetch when the test app starts (FX_AUTO_REFRESH=false)', () => {
      expect(client.fetchLatest).not.toHaveBeenCalled();
    });

    it('fetches once at start-up when the flag is true', async () => {
      client.fetchLatest.mockResolvedValue(goodAnswer());

      withFlag('true').onApplicationBootstrap();

      await vi.waitFor(() =>
        expect(client.fetchLatest).toHaveBeenCalledTimes(1),
      );
    });

    it('does not fetch at start-up or in the daily job when the flag is false', async () => {
      const off = withFlag('false');

      off.onApplicationBootstrap();
      await off.dailyRefresh();

      expect(client.fetchLatest).not.toHaveBeenCalled();
    });

    it('the daily job refreshes when the flag is not false', async () => {
      client.fetchLatest.mockResolvedValue(goodAnswer());

      await withFlag(undefined).dailyRefresh();

      expect(client.fetchLatest).toHaveBeenCalledTimes(1);
      await expect(model.countDocuments()).resolves.toBe(1);
    });
  });
});
