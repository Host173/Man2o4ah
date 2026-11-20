import { ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { decidePaymentStart, paymentStatusAfter } from './payment-rules.js';
import type { StartDecision } from './payment-rules.js';
import type { Payable, PayableStatus } from './ports/payable-booking.port.js';
import type { PaymentStatus } from './schemas/payment.schema.js';

const NOW = new Date('2027-01-01T10:00:00.000Z');
const MINUTE_MS = 60_000;

type Existing = { id: string; status: PaymentStatus } | null;

interface Row {
  name: string;
  status?: PayableStatus;
  /** Milliseconds after `NOW`; default 5 minutes. */
  holdOffsetMs?: number;
  accepted?: boolean;
  existing?: Existing;
  amountMinor?: number;
}

function decide(row: Row): StartDecision {
  const payable: Payable = {
    amountMinor: row.amountMinor ?? 25_000,
    currency: 'USD',
    status: row.status ?? 'pending_payment',
    holdExpiresAt: new Date(
      NOW.getTime() + (row.holdOffsetMs ?? 5 * MINUTE_MS),
    ),
  };
  return decidePaymentStart({
    payable,
    now: NOW,
    policiesAccepted: row.accepted ?? true,
    existing: row.existing ?? null,
  });
}

/** The code of the 409 `decide` throws; fails the test if it doesn't throw one. */
function conflictCode(row: Row): string {
  try {
    decide(row);
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    return ((error as ConflictException).getResponse() as { code: string })
      .code;
  }
  throw new Error(`"${row.name}" did not throw`);
}

describe('decidePaymentStart (PAY-01)', () => {
  const refused: (Row & { code: string })[] = [
    {
      name: 'confirmed booking',
      status: 'confirmed',
      code: ErrorCode.InvalidStatusTransition,
    },
    {
      name: 'completed booking',
      status: 'completed',
      code: ErrorCode.InvalidStatusTransition,
    },
    {
      // The status is checked first: an expired booking with no acceptance is still HOLD_EXPIRED.
      name: 'expired booking',
      status: 'expired',
      accepted: false,
      code: ErrorCode.HoldExpired,
    },
    {
      name: 'cancelled booking',
      status: 'cancelled',
      code: ErrorCode.HoldExpired,
    },
    {
      // The hold must end after now.
      name: 'hold ends exactly now',
      holdOffsetMs: 0,
      code: ErrorCode.HoldExpired,
    },
    {
      name: 'hold ended 1 ms ago',
      holdOffsetMs: -1,
      code: ErrorCode.HoldExpired,
    },
    {
      // The hold is checked before the acceptance.
      name: 'expired hold, not accepted',
      holdOffsetMs: -1,
      accepted: false,
      code: ErrorCode.HoldExpired,
    },
    {
      name: 'policies not accepted',
      accepted: false,
      code: ErrorCode.PoliciesNotAccepted,
    },
    {
      name: 'payment already succeeded',
      existing: { id: 'p1', status: 'succeeded' },
      code: ErrorCode.InvalidStatusTransition,
    },
    {
      name: 'payment canceled',
      existing: { id: 'p1', status: 'canceled' },
      code: ErrorCode.HoldExpired,
    },
    {
      // Stripe rejects an amount of 0.
      name: 'nothing to pay',
      amountMinor: 0,
      code: ErrorCode.InvalidStatusTransition,
    },
  ];

  it.each(refused)('refuses with 409: $name', (row) => {
    expect(conflictCode(row)).toBe(row.code);
  });

  it('refuses with the message "This booking is already paid"', () => {
    expect(() => decide({ name: 'paid', status: 'confirmed' })).toThrow(
      'This booking is already paid',
    );
  });

  it('refuses with the message "The hold has expired"', () => {
    expect(() => decide({ name: 'expired', status: 'expired' })).toThrow(
      'The hold has expired',
    );
  });

  it('refuses with the message "Accept the policies before paying"', () => {
    expect(() => decide({ name: 'not accepted', accepted: false })).toThrow(
      'Accept the policies before paying',
    );
  });

  it('refuses with the message "There is nothing to pay"', () => {
    expect(() => decide({ name: 'free', amountMinor: 0 })).toThrow(
      'There is nothing to pay',
    );
  });

  it('creates a payment when the hold ends 1 ms after now', () => {
    expect(decide({ name: 'just valid', holdOffsetMs: 1 })).toEqual({
      action: 'create',
    });
  });

  it('creates a payment for a fresh pending booking', () => {
    expect(decide({ name: 'fresh' })).toEqual({ action: 'create' });
  });

  it.each<PaymentStatus>(['pending', 'failed'])(
    'reuses the booking’s %s payment',
    (status) => {
      expect(
        decide({ name: status, existing: { id: 'pay-7', status } }),
      ).toEqual({ action: 'reuse', paymentId: 'pay-7' });
    },
  );
});

describe('paymentStatusAfter (PAY-01)', () => {
  const rows: [
    'payment_intent.succeeded' | 'payment_intent.payment_failed',
    PaymentStatus,
    PaymentStatus | null,
  ][] = [
    ['payment_intent.succeeded', 'pending', 'succeeded'],
    ['payment_intent.succeeded', 'failed', 'succeeded'],
    ['payment_intent.succeeded', 'succeeded', null],
    // A late payment must still be recorded, so the booking module can refund it.
    ['payment_intent.succeeded', 'canceled', 'succeeded'],
    ['payment_intent.payment_failed', 'pending', 'failed'],
    ['payment_intent.payment_failed', 'failed', null],
    ['payment_intent.payment_failed', 'succeeded', null],
    ['payment_intent.payment_failed', 'canceled', null],
  ];

  it.each(rows)('%s while %s → %s', (event, current, expected) => {
    expect(paymentStatusAfter(event, current)).toBe(expected);
  });
});
