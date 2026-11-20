import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import {
  assertDateRange,
  assertStayDates,
  normalizeAvailability,
  parseAvailabilityRange,
} from './room-date-ranges.js';

const today = toDateOnly('2026-11-18');

describe('room calendar-date rules (INV-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T23:59:59Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('accepts a stay starting today in UTC and a single-night inclusive range', () => {
    expect(() => assertStayDates(today, addDays(today, 1))).not.toThrow();
    expect(() => assertDateRange(today, today)).not.toThrow();
  });

  it.each([
    [today, today],
    [addDays(today, 1), today],
    [addDays(today, -1), addDays(today, 1)],
    [new Date('invalid'), addDays(today, 1)],
    [new Date('2026-11-18T01:00:00Z'), addDays(today, 1)],
  ])('rejects invalid stay dates %s to %s', (checkIn, checkOut) => {
    expect(() => assertStayDates(checkIn, checkOut)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: ErrorCode.ValidationFailed }),
      }),
    );
  });

  it('sorts and merges adjacent ranges without changing the caller input', () => {
    const ranges = [
      { fromDate: addDays(today, 2), toDate: addDays(today, 3) },
      { fromDate: today, toDate: addDays(today, 1) },
      { fromDate: addDays(today, 5), toDate: addDays(today, 5) },
    ];
    const original = structuredClone(ranges);
    expect(normalizeAvailability(ranges)).toEqual([
      { fromDate: today, toDate: addDays(today, 3) },
      { fromDate: addDays(today, 5), toDate: addDays(today, 5) },
    ]);
    expect(ranges).toEqual(original);
  });

  it('rejects ranges sharing an inclusive endpoint', () => {
    expect(() =>
      normalizeAvailability([
        { fromDate: today, toDate: addDays(today, 1) },
        { fromDate: addDays(today, 1), toDate: addDays(today, 2) },
      ]),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: ErrorCode.ValidationFailed }),
      }),
    );
  });

  it('parses inclusive calendar-date ranges, including a single night', () => {
    expect(
      parseAvailabilityRange({
        fromDate: '2026-12-01',
        toDate: '2026-12-01',
      }),
    ).toEqual({
      fromDate: toDateOnly('2026-12-01'),
      toDate: toDateOnly('2026-12-01'),
    });
  });

  it.each([
    ['2026-02-30', '2026-03-01', 'fromDate'],
    ['2026-12-01T00:00:00Z', '2026-12-02', 'fromDate'],
    ['2026-12-01', '2026-12-32', 'toDate'],
    ['2026-12-02', '2026-12-01', 'toDate'],
  ])(
    'rejects invalid availability dates %s to %s',
    (fromDate, toDate, field) => {
      expect(() => parseAvailabilityRange({ fromDate, toDate })).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: ErrorCode.ValidationFailed,
            details: expect.arrayContaining([
              expect.objectContaining({ field }),
            ]),
          }),
        }),
      );
    },
  );
});
