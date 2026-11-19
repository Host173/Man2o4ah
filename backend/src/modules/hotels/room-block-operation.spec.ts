import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { parseRoomBlockOperation } from './room-block-operation.js';

describe('room block length (HTL-06)', () => {
  it.each([1, 365])(
    'accepts %i inclusive nights, including across a leap day',
    (nights) => {
      const fromDate = toDateOnly('2028-01-01');
      const toDate = addDays(fromDate, nights - 1);
      expect(
        parseRoomBlockOperation({
          op: 'BLOCK',
          fromDate: '2028-01-01',
          toDate: toDate.toISOString().slice(0, 10),
        }),
      ).toEqual({ op: 'BLOCK', fromDate, toDate });
    },
  );

  it.each(['2028-12-31', '2999-12-31'])(
    'rejects more than 365 inclusive nights ending %s before inventory allocation',
    (toDate) => {
      expect(() =>
        parseRoomBlockOperation({
          op: 'BLOCK',
          fromDate: '2028-01-01',
          toDate,
        }),
      ).toThrow(
        expect.objectContaining({
          status: 400,
          response: {
            code: ErrorCode.ValidationFailed,
            message: expect.any(String),
            details: [
              {
                field: 'toDate',
                message: expect.any(String),
              },
            ],
          },
        }),
      );
    },
  );
});
