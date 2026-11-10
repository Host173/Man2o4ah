import type { Model } from 'mongoose';
import { toDateOnly } from '../../src/common/dates/date-only.js';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from '../../src/modules/fx/schemas/exchange-rate.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

function rateDoc(overrides: Record<string, unknown> = {}) {
  return {
    rateDate: toDateOnly('2026-11-10'),
    base: 'USD',
    rates: { USD: 1, EUR: 0.92, EGP: 48.5, JPY: 151.2 },
    fetchedAt: new Date('2026-11-10T00:05:00.000Z'),
    source: 'fxratesapi',
    ...overrides,
  };
}

describe('fx schemas', () => {
  let db: TestDatabase;
  let rates: Model<ExchangeRate>;

  beforeAll(async () => {
    db = await startTestDatabase('fx');
    rates = db.connection.model<ExchangeRate>(
      ExchangeRate.name,
      ExchangeRateSchema,
    );
    await rates.init();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await rates.deleteMany({});
  });

  it('uses the exchange_rates collection', () => {
    expect(rates.collection.collectionName).toBe('exchange_rates');
  });

  it('saves a valid document with its rates as a map', async () => {
    const saved = await rates.create(rateDoc());
    expect(saved.rates).toBeInstanceOf(Map);
    expect(saved.rates.get('EGP')).toBe(48.5);
    expect(saved.get('createdAt')).toBeInstanceOf(Date);
  });

  it('rejects a second document for the same rateDate', async () => {
    await rates.create(rateDoc());
    await expect(rates.create(rateDoc())).rejects.toMatchObject({
      code: 11000,
    });
    await expect(
      rates.create(rateDoc({ rateDate: toDateOnly('2026-11-11') })),
    ).resolves.toBeDefined();
  });

  it('rejects a zero or negative rate', async () => {
    for (const value of [0, -0.5]) {
      await expect(
        new rates(
          rateDoc({ rates: { USD: 1, EUR: value, EGP: 48.5 } }),
        ).validate(),
      ).rejects.toThrow(/rates\.EUR must be greater than 0/);
    }
    await expect(
      new rates(rateDoc({ rates: { USD: 1, EUR: 0.0001 } })).validate(),
    ).resolves.toBeUndefined();
  });

  it('requires the base currency in the rates with a rate of 1', async () => {
    for (const map of [
      { EUR: 0.92, EGP: 48.5 },
      { USD: 1.01, EUR: 0.92 },
      {},
    ]) {
      await expect(
        new rates(rateDoc({ rates: map })).validate(),
      ).rejects.toThrow(
        /rates must contain the base currency with a rate of 1/,
      );
    }
    await expect(
      new rates(
        rateDoc({ base: 'EUR', rates: { EUR: 1, USD: 1.087 } }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('requires every field and a DateOnly rateDate', async () => {
    const invalid = [
      { rateDate: undefined },
      { rateDate: new Date('2026-11-10T00:05:00.000Z') },
      { base: undefined },
      { rates: undefined },
      { fetchedAt: undefined },
      { source: undefined },
    ];
    for (const overrides of invalid) {
      await expect(new rates(rateDoc(overrides)).validate()).rejects.toThrow(
        new RegExp(Object.keys(overrides)[0]),
      );
    }
    await expect(new rates(rateDoc()).validate()).resolves.toBeUndefined();
  });

  it('has exactly the indexes from the data model', async () => {
    const indexes = await rates.collection.indexes();
    expect(
      indexes.map((index) => ({
        key: index.key,
        unique: index.unique ?? false,
      })),
    ).toEqual(
      expect.arrayContaining([
        { key: { _id: 1 }, unique: false },
        { key: { rateDate: -1 }, unique: true },
      ]),
    );
    expect(indexes).toHaveLength(2);
  });
});
