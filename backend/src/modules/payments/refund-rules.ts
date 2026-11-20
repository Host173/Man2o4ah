import { BadRequestException, ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { RefundRequest } from './payments.types.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
import type { RefundStatus } from './schemas/refund.schema.js';
import type { GatewayRefundStatus } from './stripe/stripe-gateway.js';

/** What the check needs from the booking's payment (ids as strings). */
export interface PaidPayment {
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  userId: string;
}

/** The 400 the refund contract uses: one field and why it is wrong (the fake's shape). */
function invalidRefund(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'Invalid refund',
    details: [{ field, message }],
  });
}

/** Throws 400 when the amount isn't a positive integer (checked before anything is read). */
export function assertRefundAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw invalidRefund('amountMinor', 'must be greater than 0');
  }
}

/** A 24-character hex id; anything else would make the driver throw a 500. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Throws 400 when the booking or user id isn't a valid id (checked before anything is read). */
export function assertRefundIds(
  request: Pick<RefundRequest, 'bookingId' | 'userId'>,
): void {
  if (!OBJECT_ID.test(request.bookingId)) {
    throw invalidRefund('bookingId', 'must be a valid id');
  }
  if (!OBJECT_ID.test(request.userId)) {
    throw invalidRefund('userId', 'must be a valid id');
  }
}

/**
 * Throws the right HttpException when the booking's payment can't be refunded
 * with this request (PAY-03). Checked in this order: the payment's status, the
 * amount, the currency, the payer. A late payment needs no special case: PAY-01
 * records it as `succeeded`.
 */
export function checkRefundRequest(
  request: RefundRequest,
  payment: PaidPayment | null,
): asserts payment is PaidPayment {
  if (!payment || payment.status !== 'succeeded') {
    throw new ConflictException({
      code: ErrorCode.InvalidStatusTransition,
      message: 'The booking has no succeeded payment',
    });
  }
  // Equal is allowed: a 100% refund.
  if (request.amountMinor > payment.amountMinor) {
    throw invalidRefund('amountMinor', 'must not exceed the amount paid');
  }
  if (request.currency !== payment.currency) {
    throw invalidRefund('currency', 'must match the payment currency');
  }
  if (request.userId !== payment.userId) {
    throw invalidRefund('userId', 'must be the payer');
  }
}

/** Stripe's refund status as ours. */
export function refundStatusFromGateway(
  status: GatewayRefundStatus,
): RefundStatus {
  switch (status) {
    case 'succeeded':
      return 'refunded';
    case 'failed':
    case 'canceled':
      return 'failed';
    case 'pending':
    case 'requires_action':
      return 'pending';
  }
}

/**
 * The status a webhook moves a refund to, or null to leave it as it is. Stripe
 * can fail a refund after it succeeded, so `refunded` can still become `failed`.
 */
export function refundStatusAfter(
  gatewayStatus: GatewayRefundStatus,
  current: RefundStatus,
): RefundStatus | null {
  const next = refundStatusFromGateway(gatewayStatus);
  // A status Stripe still calls pending never moves a refund.
  if (next === 'pending') return null;
  return next === current ? null : next;
}
