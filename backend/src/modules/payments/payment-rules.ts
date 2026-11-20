import { ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { Payable } from './ports/payable-booking.port.js';
import type { PaymentStatus } from './schemas/payment.schema.js';

/** Whether to create the booking's PaymentIntent or reuse the one it already has. */
export type StartDecision =
  { action: 'create' } | { action: 'reuse'; paymentId: string };

/** The Stripe events that move a payment (PAY-01). */
export type PaymentEventType =
  'payment_intent.succeeded' | 'payment_intent.payment_failed';

function conflict(code: ErrorCode, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * Throws the right 409, or says whether to create a PaymentIntent or reuse the
 * booking's (PAY-01). Checked in this order: the booking's status, the hold,
 * the policy acceptance, the amount, then the booking's existing payment.
 */
export function decidePaymentStart(input: {
  payable: Payable;
  now: Date;
  policiesAccepted: boolean;
  existing: { id: string; status: PaymentStatus } | null;
}): StartDecision {
  const { payable, now, policiesAccepted, existing } = input;

  if (payable.status === 'confirmed' || payable.status === 'completed') {
    throw conflict(
      ErrorCode.InvalidStatusTransition,
      'This booking is already paid',
    );
  }
  if (payable.status !== 'pending_payment') {
    throw conflict(ErrorCode.HoldExpired, 'The hold has expired');
  }
  // The hold must end after now: a hold ending exactly now is over.
  if (payable.holdExpiresAt.getTime() <= now.getTime()) {
    throw conflict(ErrorCode.HoldExpired, 'The hold has expired');
  }
  if (!policiesAccepted) {
    throw conflict(
      ErrorCode.PoliciesNotAccepted,
      'Accept the policies before paying',
    );
  }
  // Stripe rejects an amount of 0.
  if (payable.amountMinor <= 0) {
    throw conflict(
      ErrorCode.InvalidStatusTransition,
      'There is nothing to pay',
    );
  }
  if (!existing) return { action: 'create' };

  switch (existing.status) {
    case 'pending':
    case 'failed':
      return { action: 'reuse', paymentId: existing.id };
    case 'succeeded':
      throw conflict(
        ErrorCode.InvalidStatusTransition,
        'This booking is already paid',
      );
    case 'canceled':
      throw conflict(ErrorCode.HoldExpired, 'The hold has expired');
  }
}

/**
 * The status a webhook event moves the payment to, or null to leave it as it is.
 * A `canceled` payment still becomes `succeeded` when Stripe says it was paid:
 * a late payment must be recorded so the booking module can refund it.
 */
export function paymentStatusAfter(
  event: PaymentEventType,
  current: PaymentStatus,
): PaymentStatus | null {
  if (event === 'payment_intent.succeeded') {
    return current === 'succeeded' ? null : 'succeeded';
  }
  return current === 'pending' ? 'failed' : null;
}
