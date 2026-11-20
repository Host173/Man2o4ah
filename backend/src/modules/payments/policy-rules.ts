import { ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { Payable } from './ports/payable-booking.port.js';

/**
 * Throws the right 409 when the booking's policies can't be accepted any more
 * (PAY-02): it is already paid, or its hold is over. Returns normally otherwise.
 * Checked in this order: the booking's status, then the hold.
 */
export function assertCanAcceptPolicies(payable: Payable, now: Date): void {
  if (payable.status === 'confirmed' || payable.status === 'completed') {
    throw new ConflictException({
      code: ErrorCode.InvalidStatusTransition,
      message: 'This booking is already paid',
    });
  }
  // Only `pending_payment` is left after `confirmed` and `completed`.
  if (payable.status !== 'pending_payment') {
    throw new ConflictException({
      code: ErrorCode.HoldExpired,
      message: 'The hold has expired',
    });
  }
  // The hold must end after now: a hold ending exactly now is over.
  if (payable.holdExpiresAt.getTime() <= now.getTime()) {
    throw new ConflictException({
      code: ErrorCode.HoldExpired,
      message: 'The hold has expired',
    });
  }
}
