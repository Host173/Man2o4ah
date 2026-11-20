import { ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { assertCanAcceptPolicies } from './policy-rules.js';
import type { Payable, PayableStatus } from './ports/payable-booking.port.js';

const NOW = new Date('2027-01-01T10:00:00.000Z');
const MINUTE_MS = 60_000;

interface Row {
  name: string;
  status?: PayableStatus;
  /** Milliseconds after `NOW`; default 5 minutes. */
  holdOffsetMs?: number;
  amountMinor?: number;
}

function payableOf(row: Row): Payable {
  return {
    amountMinor: row.amountMinor ?? 25_000,
    currency: 'USD',
    status: row.status ?? 'pending_payment',
    holdExpiresAt: new Date(
      NOW.getTime() + (row.holdOffsetMs ?? 5 * MINUTE_MS),
    ),
  };
}

const ALREADY_PAID = {
  code: ErrorCode.InvalidStatusTransition,
  message: 'This booking is already paid',
};
const HOLD_OVER = {
  code: ErrorCode.HoldExpired,
  message: 'The hold has expired',
};

describe('assertCanAcceptPolicies (PAY-02)', () => {
  const refused: (Row & { expected: { code: string; message: string } })[] = [
    { name: 'confirmed booking', status: 'confirmed', expected: ALREADY_PAID },
    { name: 'completed booking', status: 'completed', expected: ALREADY_PAID },
    { name: 'expired booking', status: 'expired', expected: HOLD_OVER },
    { name: 'cancelled booking', status: 'cancelled', expected: HOLD_OVER },
    {
      // The hold must end after now, as in PAY-01.
      name: 'hold ends exactly now',
      holdOffsetMs: 0,
      expected: HOLD_OVER,
    },
    { name: 'hold ended 1 ms ago', holdOffsetMs: -1, expected: HOLD_OVER },
    {
      // The status is checked before the hold.
      name: 'confirmed booking with an over hold',
      status: 'confirmed',
      holdOffsetMs: -1,
      expected: ALREADY_PAID,
    },
  ];

  it.each(refused)('refuses with 409: $name', (row) => {
    try {
      assertCanAcceptPolicies(payableOf(row), NOW);
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual(row.expected);
      return;
    }
    throw new Error(`"${row.name}" did not throw`);
  });

  const allowed: Row[] = [
    { name: 'hold ends 1 ms after now', holdOffsetMs: 1 },
    { name: 'hold ends in 5 minutes' },
    // Accepting is not paying: PAY-01 refuses the 0 amount at payment time.
    { name: 'amount 0', amountMinor: 0 },
  ];

  it.each(allowed)('allows: $name', (row) => {
    expect(() => assertCanAcceptPolicies(payableOf(row), NOW)).not.toThrow();
  });
});
