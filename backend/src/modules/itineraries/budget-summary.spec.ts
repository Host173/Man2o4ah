import { ErrorCode } from '../../common/errors/error-codes.js';
import type { Converter } from '../fx/fx.types.js';
import { FakeFxService } from '../../../test/fakes/fx.fake.js';
import { buildBudgetSummary } from './budget-summary.js';
import type { BudgetSummaryInput } from './itineraries.types.js';

/** Unit tests of the pure ITN-14/18 calculator, using the FX contract fake. */
describe('budget summary calculator (ITN-14, ITN-18)', () => {
  const startDate = new Date('2027-04-01T00:00:00.000Z');
  const converter = async (
    rates: Record<string, number> = { USD: 1, EGP: 50, EUR: 10, JPY: 100 },
  ): Promise<Converter> =>
    new FakeFxService({
      rates,
      minorUnits: { JPY: 0 },
      rateDate: '2026-11-01',
    }).getConverter();

  const input = (): BudgetSummaryInput => ({
    startDate,
    days: [
      {
        _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        cityId: 'cairo',
        budgetEntries: [
          {
            category: 'food',
            amountMinor: 100,
            currency: 'EGP',
          },
          {
            category: 'accommodation',
            amountMinor: 200,
            currency: 'EUR',
          },
        ],
        activities: [{ cost: { amountMinor: 1000, currency: 'EGP' } }],
      },
      {
        _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        cityId: 'cairo',
        budgetEntries: [
          { category: 'in_city_transport', amountMinor: 500, currency: 'EGP' },
        ],
        activities: [{}],
      },
      {
        _id: 'cccccccccccccccccccccccc',
        cityId: 'dubai',
        budgetEntries: [
          { category: 'food', amountMinor: 100, currency: 'JPY' },
        ],
        activities: [],
      },
    ],
    transportCosts: [
      {
        dayId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        amountMinor: 30000,
        currency: 'EGP',
      },
      {
        dayId: 'cccccccccccccccccccccccc',
        amountMinor: 5000,
        currency: 'EGP',
      },
    ],
  });

  it('converts every entry, then rolls up categories, days, groups and the total', async () => {
    const result = buildBudgetSummary(input(), await converter(), 'EGP');
    expect(result.displayCurrency).toBe('EGP');
    expect(result.rateDate).toBe('2026-11-01');
    expect(result.byCategory).toEqual({
      food: { amountMinor: 5100, currency: 'EGP' },
      accommodation: { amountMinor: 1000, currency: 'EGP' },
      in_city_transport: { amountMinor: 500, currency: 'EGP' },
      activities: { amountMinor: 1000, currency: 'EGP' },
      intercity_transport: { amountMinor: 35000, currency: 'EGP' },
    });
    expect(result.total).toEqual({ amountMinor: 42600, currency: 'EGP' });
    expect(
      result.byDay.map((day) => [day.dayNumber, day.date, day.cityId]),
    ).toEqual([
      [1, '2027-04-01', 'cairo'],
      [2, '2027-04-02', 'cairo'],
      [3, '2027-04-03', 'dubai'],
    ]);
    expect(result.byDay.map((day) => day.total.amountMinor)).toEqual([
      32100, 500, 10000,
    ]);
    expect(result.byDay[0].byCategory).toEqual({
      food: { amountMinor: 100, currency: 'EGP' },
      accommodation: { amountMinor: 1000, currency: 'EGP' },
      in_city_transport: { amountMinor: 0, currency: 'EGP' },
      activities: { amountMinor: 1000, currency: 'EGP' },
      intercity_transport: { amountMinor: 30000, currency: 'EGP' },
    });
    expect(result.byCityGroup).toEqual([
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 2,
        dayCount: 2,
        checkIn: '2027-04-01',
        checkOut: '2027-04-03',
        total: { amountMinor: 32600, currency: 'EGP' },
      },
      {
        cityId: 'dubai',
        fromDay: 3,
        toDay: 3,
        dayCount: 1,
        checkIn: '2027-04-03',
        checkOut: '2027-04-04',
        total: { amountMinor: 10000, currency: 'EGP' },
      },
    ]);
  });

  it('can display the same trip in another preferred currency', async () => {
    const result = buildBudgetSummary(input(), await converter(), 'USD');
    expect(result.displayCurrency).toBe('USD');
    expect(result.total).toEqual({ amountMinor: 852, currency: 'USD' });
    expect(result.byCategory.food).toEqual({
      amountMinor: 102,
      currency: 'USD',
    });
    expect(result.byCityGroup[0].total).toEqual({
      amountMinor: 652,
      currency: 'USD',
    });
  });

  it('rounds each conversion half up before summing', async () => {
    const data: BudgetSummaryInput = {
      startDate,
      days: [
        {
          _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
          cityId: 'cairo',
          budgetEntries: [1, 1, 1].map(() => ({
            category: 'food' as const,
            amountMinor: 1,
            currency: 'JPY',
          })),
          activities: [],
        },
      ],
      transportCosts: [],
    };
    const result = buildBudgetSummary(
      data,
      await converter({ USD: 1, JPY: 3 }),
      'USD',
    );
    // Each 1 JPY is 33.33 USD minor → 33; one lump sum would be 100.
    expect(result.byCategory.food.amountMinor).toBe(99);
    expect(result.total.amountMinor).toBe(99);
  });

  it('returns a complete zero summary for an empty itinerary', async () => {
    const result = buildBudgetSummary(
      { startDate, days: [], transportCosts: [] },
      await converter(),
      'EGP',
    );
    expect(result).toEqual({
      displayCurrency: 'EGP',
      rateDate: '2026-11-01',
      total: { amountMinor: 0, currency: 'EGP' },
      byCategory: {
        food: { amountMinor: 0, currency: 'EGP' },
        accommodation: { amountMinor: 0, currency: 'EGP' },
        in_city_transport: { amountMinor: 0, currency: 'EGP' },
        activities: { amountMinor: 0, currency: 'EGP' },
        intercity_transport: { amountMinor: 0, currency: 'EGP' },
      },
      byDay: [],
      byCityGroup: [],
    });
  });

  it.each([
    [[Number.MAX_SAFE_INTEGER, 1, 1]],
    [[Number.MAX_SAFE_INTEGER], [1]],
  ])(
    'rejects totals outside safe integer minor units: %j',
    async (...amounts) => {
      const data: BudgetSummaryInput = {
        startDate,
        days: amounts.map((values, index) => ({
          _id: String(index),
          cityId: 'cairo',
          budgetEntries: values.map((amountMinor) => ({
            category: 'food',
            amountMinor,
            currency: 'USD',
          })),
          activities: [],
        })),
        transportCosts: [],
      };
      const fx = await converter();
      expect(() => buildBudgetSummary(data, fx, 'USD')).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: ErrorCode.ValidationFailed,
          }),
        }),
      );
    },
  );

  it('rejects a conversion that cannot be represented in minor units', async () => {
    const data: BudgetSummaryInput = {
      startDate,
      days: [
        {
          _id: 'day',
          cityId: 'cairo',
          budgetEntries: [
            {
              category: 'food',
              amountMinor: Number.MAX_SAFE_INTEGER,
              currency: 'USD',
            },
          ],
          activities: [],
        },
      ],
      transportCosts: [],
    };
    const fx = await converter();
    expect(() => buildBudgetSummary(data, fx, 'EGP')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: ErrorCode.ValidationFailed,
        }),
      }),
    );
  });

  it('propagates the FX unsupported-currency error for an unknown entry currency', async () => {
    const base = input();
    const data: BudgetSummaryInput = {
      ...base,
      days: base.days.map((day, index) =>
        index === 0
          ? {
              ...day,
              budgetEntries: [
                ...day.budgetEntries,
                { category: 'food' as const, amountMinor: 1, currency: 'XXX' },
              ],
            }
          : day,
      ),
    };
    const fx = await converter();
    expect(() => buildBudgetSummary(data, fx, 'EGP')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: ErrorCode.UnsupportedCurrency,
        }),
      }),
    );
  });
});
