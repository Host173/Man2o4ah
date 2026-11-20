import { BadRequestException, ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import {
  assertRefundAmount,
  assertRefundIds,
  checkRefundRequest,
  refundStatusAfter,
  refundStatusFromGateway,
} from './refund-rules.js';
import type { PaidPayment } from './refund-rules.js';
import type { RefundRequest } from './payments.types.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
import type { RefundStatus } from './schemas/refund.schema.js';
import type { GatewayRefundStatus } from './stripe/stripe-gateway.js';

const USER = '6553a1f0c2b4e8a9d0f1a2b3';
const OTHER_USER = '6553a1f0c2b4e8a9d0f1a2b4';

const NO_PAYMENT = {
  code: ErrorCode.InvalidStatusTransition,
  message: 'The booking has no succeeded payment',
};

function invalid(field: string, message: string) {
  return {
    code: ErrorCode.ValidationFailed,
    message: 'Invalid refund',
    details: [{ field, message }],
  };
}

/** The error `run` throws; fails the test if it doesn't throw. */
function thrown(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('did not throw');
}

describe('assertRefundAmount (PAY-03)', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'refuses %s with 400 VALIDATION_FAILED on amountMinor',
    (amount) => {
      const error = thrown(() => assertRefundAmount(amount));

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        invalid('amountMinor', 'must be greater than 0'),
      );
    },
  );

  it.each([1, 25_000, Number.MAX_SAFE_INTEGER])('accepts %s', (amount) => {
    expect(() => assertRefundAmount(amount)).not.toThrow();
  });
});

describe('assertRefundIds (PAY-03)', () => {
  const ID = '6553a1f0c2b4e8a9d0f1a2b3';

  it.each([
    ['not-an-id'],
    [''],
    ['6553a1f0c2b4e8a9d0f1a2b3a'],
    // 12 characters: a driver would read it as 12 raw bytes, not as an id.
    ['abcdefghijkl'],
  ])('refuses the bookingId %j with 400 on bookingId', (bookingId) => {
    const error = thrown(() => assertRefundIds({ bookingId, userId: ID }));

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual(
      invalid('bookingId', 'must be a valid id'),
    );
  });

  it.each([['not-an-id'], ['']])(
    'refuses the userId %j with 400 on userId',
    (userId) => {
      const error = thrown(() => assertRefundIds({ bookingId: ID, userId }));

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        invalid('userId', 'must be a valid id'),
      );
    },
  );

  it('checks the bookingId before the userId', () => {
    const error = thrown(() =>
      assertRefundIds({ bookingId: 'bad', userId: 'also-bad' }),
    );

    expect((error as BadRequestException).getResponse()).toEqual(
      invalid('bookingId', 'must be a valid id'),
    );
  });

  it.each([ID, ID.toUpperCase()])('accepts the id %s', (id) => {
    expect(() => assertRefundIds({ bookingId: id, userId: id })).not.toThrow();
  });
});

describe('checkRefundRequest (PAY-03)', () => {
  const payment: PaidPayment = {
    status: 'succeeded',
    amountMinor: 25_000,
    currency: 'USD',
    userId: USER,
  };

  function request(overrides: Partial<RefundRequest> = {}): RefundRequest {
    return {
      bookingType: 'flight',
      bookingId: '6553a1f0c2b4e8a9d0f1a2b9',
      userId: USER,
      amountMinor: 10_000,
      currency: 'USD',
      reason: 'user_cancellation',
      ...overrides,
    };
  }

  const refused: {
    name: string;
    request?: Partial<RefundRequest>;
    payment: PaidPayment | null;
    error: typeof ConflictException | typeof BadRequestException;
    response: unknown;
  }[] = [
    {
      name: 'no payment for the booking',
      payment: null,
      error: ConflictException,
      response: NO_PAYMENT,
    },
    ...(['pending', 'failed', 'canceled'] as PaymentStatus[]).map((status) => ({
      name: `a ${status} payment`,
      payment: { ...payment, status },
      error: ConflictException,
      response: NO_PAYMENT,
    })),
    {
      name: 'an amount above the amount paid (25001)',
      request: { amountMinor: 25_001 },
      payment,
      error: BadRequestException,
      response: invalid('amountMinor', 'must not exceed the amount paid'),
    },
    {
      name: 'another currency',
      request: { currency: 'EUR' },
      payment,
      error: BadRequestException,
      response: invalid('currency', 'must match the payment currency'),
    },
    {
      name: 'someone who did not pay',
      request: { userId: OTHER_USER },
      payment,
      error: BadRequestException,
      response: invalid('userId', 'must be the payer'),
    },
    {
      // The status is checked before the amount.
      name: 'a pending payment and an amount above it',
      request: { amountMinor: 99_999 },
      payment: { ...payment, status: 'pending' },
      error: ConflictException,
      response: NO_PAYMENT,
    },
    {
      // The amount is checked before the currency and the payer.
      name: 'an amount above the amount paid and another currency',
      request: { amountMinor: 25_001, currency: 'EUR' },
      payment,
      error: BadRequestException,
      response: invalid('amountMinor', 'must not exceed the amount paid'),
    },
    {
      // The currency is checked before the payer.
      name: 'another currency and another payer',
      request: { currency: 'EUR', userId: OTHER_USER },
      payment,
      error: BadRequestException,
      response: invalid('currency', 'must match the payment currency'),
    },
  ];

  it.each(refused)('refuses: $name', (row) => {
    const error = thrown(() =>
      checkRefundRequest(request(row.request), row.payment),
    );

    expect(error).toBeInstanceOf(row.error);
    expect((error as BadRequestException).getResponse()).toEqual(row.response);
  });

  it.each([
    ['a partial refund', 10_000],
    ['one minor unit below the amount paid', 24_999],
    ['exactly the amount paid (100%)', 25_000],
    ['one minor unit', 1],
  ])('allows %s', (_name, amountMinor) => {
    expect(() =>
      checkRefundRequest(request({ amountMinor }), payment),
    ).not.toThrow();
  });
});

describe('refundStatusFromGateway (PAY-03)', () => {
  it.each<[GatewayRefundStatus, RefundStatus]>([
    ['succeeded', 'refunded'],
    ['failed', 'failed'],
    ['canceled', 'failed'],
    ['pending', 'pending'],
    ['requires_action', 'pending'],
  ])('Stripe %s is %s', (gateway, expected) => {
    expect(refundStatusFromGateway(gateway)).toBe(expected);
  });
});

describe('refundStatusAfter (PAY-03)', () => {
  const rows: [GatewayRefundStatus, RefundStatus, RefundStatus | null][] = [
    ['succeeded', 'pending', 'refunded'],
    ['succeeded', 'refunded', null],
    ['succeeded', 'failed', 'refunded'],
    ['failed', 'pending', 'failed'],
    // Stripe can fail a refund after it succeeded.
    ['failed', 'refunded', 'failed'],
    ['failed', 'failed', null],
    ['canceled', 'pending', 'failed'],
    ['canceled', 'refunded', 'failed'],
    ['canceled', 'failed', null],
    ['pending', 'pending', null],
    ['pending', 'refunded', null],
    ['pending', 'failed', null],
    ['requires_action', 'pending', null],
    ['requires_action', 'refunded', null],
    ['requires_action', 'failed', null],
  ];

  it.each(rows)('Stripe %s while %s → %s', (gateway, current, expected) => {
    expect(refundStatusAfter(gateway, current)).toBe(expected);
  });
});
