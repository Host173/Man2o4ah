import type { BookingType } from '../../../common/database/booking-type.js';

/** A booking's status, as payments sees it (mirrors both booking schemas). */
export type PayableStatus =
  'pending_payment' | 'confirmed' | 'completed' | 'expired' | 'cancelled';

/** What payments needs to charge a booking: amount, status and hold expiry (PAY-01). */
export interface Payable {
  amountMinor: number;
  currency: string;
  status: PayableStatus;
  holdExpiresAt: Date;
}

/** One cancellation tier: the refund percent that applies from `daysBefore` days out (PAY-02). */
export interface PolicyTier {
  daysBefore: number;
  refundPercent: number;
}

/** The policy snapshot of one flight segment (PAY-02). */
export interface FlightSegmentPolicies {
  direction: 'outbound' | 'return';
  flightNumber: string;
  cancellationTiers: PolicyTier[];
  freeBags: number;
  maxBagWeightKg: number;
  extraBagPriceMinor: number;
  maxExtraBagsPerPassenger: number;
}

/** The policy snapshot of a booking, by booking type (PAY-02). */
export type BookingPolicies =
  | { bookingType: 'flight'; segments: FlightSegmentPolicies[] }
  | {
      bookingType: 'hotel';
      cancellationTiers: PolicyTier[];
      checkInTime: string;
      checkOutTime: string;
    };

/** Implemented by flight-bookings and hotel-bookings; owned by payments (PAY-01, PAY-02). */
export interface PayableBooking {
  readonly bookingType: BookingType;
  /**
   * The booking's amount, status and hold expiry. Throws 404 NOT_FOUND if it doesn't exist or isn't the user's.
   * With `changeId` (FLT-27, flights only): the change waiting for payment instead, as
   * `{ amountMinor: price difference, status: 'pending_payment', holdExpiresAt }`; 404 if the
   * booking has no such pending change. The booking module has already taken the policy
   * acceptance for a change, so payments doesn't look for a `policy_acceptances` record.
   */
  getPayable(
    bookingId: string,
    userId: string,
    changeId?: string,
  ): Promise<Payable>;
  /** The booking's policy snapshot (PAY-02). Same 404 rule. */
  getPolicies(bookingId: string, userId: string): Promise<BookingPolicies>;
}
