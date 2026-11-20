import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { sumMinor } from '../../common/money/money.js';
import type { Converter } from '../fx/fx.types.js';
import { cityGroups, dayDate } from './days.js';
import type {
  BudgetCategoryTotals,
  BudgetDaySummary,
  BudgetSummaryCategory,
  BudgetSummaryInput,
  BudgetSummaryView,
  MoneyView,
} from './itineraries.types.js';

/** All five categories always appear, with zero where there are no amounts. */
export const BUDGET_SUMMARY_CATEGORIES: readonly BudgetSummaryCategory[] = [
  'food',
  'accommodation',
  'in_city_transport',
  'activities',
  'intercity_transport',
];

const money = (amountMinor: number, currency: string): MoneyView => ({
  amountMinor,
  currency,
});

function emptyCategories(currency: string): BudgetCategoryTotals {
  return {
    food: money(0, currency),
    accommodation: money(0, currency),
    in_city_transport: money(0, currency),
    activities: money(0, currency),
    intercity_transport: money(0, currency),
  };
}

function checkedAmount(calculate: () => number): number {
  try {
    return calculate();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'The converted budget exceeds supported integer minor units',
      details: [
        {
          field: 'amountMinor',
          message:
            'Converted amounts and totals must be safe integer minor units',
        },
      ],
    });
  }
}

/**
 * Converts one amount and adds it to a bucket. Conversion happens per entry
 * (half-up, ITN-18) before summing, as domain-rules.md §5 requires; the FX
 * converter rejects an unsupported source or display currency.
 */
function add(
  bucket: BudgetCategoryTotals,
  category: BudgetSummaryCategory,
  amountMinor: number,
  currency: string,
  converter: Converter,
  displayCurrency: string,
): void {
  bucket[category].amountMinor = checkedAmount(() =>
    sumMinor(
      bucket[category].amountMinor,
      converter.convert(amountMinor, currency, displayCurrency),
    ),
  );
}

function totalOf(bucket: BudgetCategoryTotals, currency: string): MoneyView {
  return money(
    checkedAmount(() =>
      sumMinor(
        ...BUDGET_SUMMARY_CATEGORIES.map(
          (category) => bucket[category].amountMinor,
        ),
      ),
    ),
    currency,
  );
}

/**
 * ITN-14/18: pure roll-up of budget entries, activity costs (ITN-10) and
 * intercity transport costs (ITN-16). Nothing is stored: day numbers, dates,
 * city groups and every total are computed on read, so add/edit/delete/reorder
 * cannot leave them stale. Uses one loaded set of rates for all conversions.
 */
export function buildBudgetSummary(
  input: BudgetSummaryInput,
  converter: Converter,
  displayCurrency: string,
): BudgetSummaryView {
  const costsByDay = new Map<
    string,
    Array<(typeof input.transportCosts)[number]>
  >();
  for (const cost of input.transportCosts) {
    const existing = [...(costsByDay.get(cost.dayId) ?? [])];
    existing.push(cost);
    costsByDay.set(cost.dayId, existing);
  }

  const byCategory = emptyCategories(displayCurrency);
  const byDay: BudgetDaySummary[] = input.days.map((day, index) => {
    const categories = emptyCategories(displayCurrency);
    for (const entry of day.budgetEntries) {
      add(
        categories,
        entry.category,
        entry.amountMinor,
        entry.currency,
        converter,
        displayCurrency,
      );
    }
    for (const activity of day.activities) {
      if (activity.cost) {
        add(
          categories,
          'activities',
          activity.cost.amountMinor,
          activity.cost.currency,
          converter,
          displayCurrency,
        );
      }
    }
    for (const cost of costsByDay.get(day._id) ?? []) {
      add(
        categories,
        'intercity_transport',
        cost.amountMinor,
        cost.currency,
        converter,
        displayCurrency,
      );
    }

    for (const category of BUDGET_SUMMARY_CATEGORIES) {
      byCategory[category].amountMinor = checkedAmount(() =>
        sumMinor(
          byCategory[category].amountMinor,
          categories[category].amountMinor,
        ),
      );
    }
    return {
      dayId: day._id,
      dayNumber: index + 1,
      date: dayDate(input.startDate, index),
      cityId: day.cityId,
      total: totalOf(categories, displayCurrency),
      byCategory: categories,
    };
  });

  const byCityGroup = cityGroups(input.days, input.startDate).map((group) => ({
    cityId: group.cityId,
    fromDay: group.fromDay,
    toDay: group.toDay,
    dayCount: group.dayCount,
    checkIn: group.checkIn,
    checkOut: group.checkOut,
    total: money(
      checkedAmount(() =>
        sumMinor(
          ...byDay
            .slice(group.fromDay - 1, group.toDay)
            .map((day) => day.total.amountMinor),
        ),
      ),
      displayCurrency,
    ),
  }));

  return {
    displayCurrency,
    rateDate: converter.rateDate,
    total: totalOf(byCategory, displayCurrency),
    byCategory,
    byDay,
    byCityGroup,
  };
}
