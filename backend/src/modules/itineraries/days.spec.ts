import { toDateOnly } from '../../common/dates/date-only.js';
import { cityGroups, dayDate, dayNumber } from './days.js';

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
