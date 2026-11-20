import { toDateOnly } from '../../common/dates/date-only.js';
import {
  cityGroups,
  dayDate,
  dayNumber,
  orderDaysById,
  withoutTransportCostsOf,
} from './days.js';

const startDate = toDateOnly('2027-04-01');

/** Just enough of a stored day for the grouping rule. */
const days = (...cityIds: string[]) => cityIds.map((cityId) => ({ cityId }));

describe('dayNumber (ITN-05)', () => {
  it('numbers the array positions from 1', () => {
    expect(dayNumber(0)).toBe(1);
    expect(dayNumber(1)).toBe(2);
  });

  it('numbers the last allowed day 60', () => {
    expect(dayNumber(59)).toBe(60);
  });
});

describe('dayDate (ITN-05)', () => {
  it('puts the first day on the start date', () => {
    expect(dayDate(startDate, 0)).toBe('2027-04-01');
  });

  it('adds one calendar day per position, across month ends and leap days', () => {
    const leapYearStart = toDateOnly('2028-02-26');

    expect(dayDate(leapYearStart, 1)).toBe('2028-02-27');
    expect(dayDate(leapYearStart, 2)).toBe('2028-02-28');
    expect(dayDate(leapYearStart, 3)).toBe('2028-02-29');
    expect(dayDate(leapYearStart, 4)).toBe('2028-03-01');
  });

  it('dates the last allowed day as startDate + 59 days', () => {
    expect(dayDate(toDateOnly('2027-01-01'), 59)).toBe('2027-03-01');
  });
});

describe('cityGroups (ITN-09)', () => {
  it('returns no groups for an itinerary without days', () => {
    expect(cityGroups([], startDate)).toEqual([]);
  });

  it('makes a single group of consecutive days in the same city', () => {
    expect(cityGroups(days('cairo', 'cairo', 'cairo'), startDate)).toEqual([
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 3,
        dayCount: 3,
        checkIn: '2027-04-01',
        checkOut: '2027-04-04',
      },
    ]);
  });

  it('starts a new group when the city changes and when it comes back later', () => {
    expect(
      cityGroups(days('cairo', 'dubai', 'dubai', 'cairo'), startDate),
    ).toEqual([
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 1,
        dayCount: 1,
        checkIn: '2027-04-01',
        checkOut: '2027-04-02',
      },
      {
        cityId: 'dubai',
        fromDay: 2,
        toDay: 3,
        dayCount: 2,
        checkIn: '2027-04-02',
        checkOut: '2027-04-04',
      },
      {
        cityId: 'cairo',
        fromDay: 4,
        toDay: 4,
        dayCount: 1,
        checkIn: '2027-04-04',
        checkOut: '2027-04-05',
      },
    ]);
  });

  it('checks out the day after the last day, even across a month end', () => {
    const groups = cityGroups(days('cairo', 'cairo'), toDateOnly('2027-01-30'));

    expect(groups[0]).toMatchObject({
      checkIn: '2027-01-30',
      checkOut: '2027-02-01',
    });
  });
});

/** Just enough of a stored day to identify it. */
const trip = [
  { _id: 'd1', cityId: 'cairo' },
  { _id: 'd2', cityId: 'dubai' },
  { _id: 'd3', cityId: 'cairo' },
];
const dayId = (day: { _id: string }) => day._id;

describe('orderDaysById (ITN-08)', () => {
  it('returns the days in the requested order', () => {
    expect(orderDaysById(trip, ['d3', 'd1', 'd2'], dayId).map(dayId)).toEqual([
      'd3',
      'd1',
      'd2',
    ]);
  });

  it('keeps the day objects and leaves the input list alone', () => {
    const before = [...trip];

    const ordered = orderDaysById(trip, ['d2', 'd3', 'd1'], dayId);

    expect(ordered[0]).toBe(trip[1]);
    expect(trip).toEqual(before);
  });

  it('accepts the current order as a no-op', () => {
    expect(orderDaysById(trip, ['d1', 'd2', 'd3'], dayId)).toEqual(trip);
  });
});

describe('withoutTransportCostsOf (ITN-07)', () => {
  const costs = [
    { _id: 'c1', dayId: 'd1' },
    { _id: 'c2', dayId: 'd2' },
    { _id: 'c3', dayId: 'd1' },
  ];

  it('drops every cost of the deleted day and keeps the rest in order', () => {
    expect(withoutTransportCostsOf(costs, 'd1')).toEqual([
      { _id: 'c2', dayId: 'd2' },
    ]);
  });

  it('returns a new list, so the stored costs are not mutated', () => {
    const kept = withoutTransportCostsOf(costs, 'd2');

    expect(kept).not.toBe(costs);
    expect(costs).toHaveLength(3);
  });

  it('keeps every cost when the day has none', () => {
    expect(withoutTransportCostsOf(costs, 'd3')).toEqual(costs);
  });
});

describe('recalculation after delete and reorder (ITN-07, ITN-08)', () => {
  it('renumbers and re-dates the remaining days after a delete', () => {
    const remaining = trip.filter((day) => day._id !== 'd2');

    expect(remaining.map((_, index) => dayNumber(index))).toEqual([1, 2]);
    expect(remaining.map((_, index) => dayDate(startDate, index))).toEqual([
      '2027-04-01',
      '2027-04-02',
    ]);
    expect(cityGroups(remaining, startDate)).toEqual([
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 2,
        dayCount: 2,
        checkIn: '2027-04-01',
        checkOut: '2027-04-03',
      },
    ]);
  });

  it('regroups and re-dates the days after a reorder', () => {
    const reordered = orderDaysById(trip, ['d3', 'd1', 'd2'], dayId);

    expect(reordered.map((_, index) => dayNumber(index))).toEqual([1, 2, 3]);
    expect(reordered.map((_, index) => dayDate(startDate, index))).toEqual([
      '2027-04-01',
      '2027-04-02',
      '2027-04-03',
    ]);
    expect(cityGroups(reordered, startDate)).toEqual([
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 2,
        dayCount: 2,
        checkIn: '2027-04-01',
        checkOut: '2027-04-03',
      },
      {
        cityId: 'dubai',
        fromDay: 3,
        toDay: 3,
        dayCount: 1,
        checkIn: '2027-04-03',
        checkOut: '2027-04-04',
      },
    ]);
  });
});
