import type { CancelledBy } from '../../common/database/cancellation.schema.js';
import type { HotelReservationStatus } from './schemas/hotel-reservation.schema.js';
import type { RefundView } from '../payments/payments.types.js';

/** HTL-21: the snapshot tiers applied to the whole reservation total. */
export interface HotelRefundPreview {
  percent: number;
  amountMinor: number;
  currency: string;
}

/** HTL-21: a whole-reservation cancellation; PAY-03 supplies the refund status. */
export interface CancelledHotelReservation {
  _id: string;
  reference: string;
  status: 'cancelled';
  cancellation: {
    cancelledAt: Date;
    cancelledBy: 'user';
    refundPercent: number;
    refundAmountMinor: number;
  };
  /** Null when no positive refund is due. A recorded gateway failure is `failed`. */
  refund: RefundView | null;
}

/**
 * Internal service input for the admin booking list (ACC-17), not an HTTP DTO.
 * `from` and `to` filter on the reservation's `createdAt`, both ends inclusive.
 */
export interface AdminHotelReservationQuery {
  status?: HotelReservationStatus;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

/** One row of the admin booking list (ACC-17). Read-only; amounts in minor units. */
export interface HotelReservationAdminView {
  bookingType: 'hotel';
  bookingId: string;
  /** Set only once the reservation is confirmed (HTL-17). */
  reference?: string;
  userId: string;
  /** The reservation's hotel (`hotelId`). */
  providerId: string;
  /** Check-in date (`checkInDate`), a UTC DateOnly. */
  startAt: Date;
  /** Check-out date (`checkOutDate`), a UTC DateOnly. */
  endAt: Date;
  totalMinor: number;
  currency: string;
  status: HotelReservationStatus;
  createdAt: Date;
}

/** One room of a hold, as saved (snapshot at hold time). */
export interface HeldRoom {
  roomId: string;
  roomName: string;
  roomType: string;
  pricePerNightMinor: number;
  adults: number;
  childAges: number[];
  /** nights × pricePerNightMinor. */
  subtotalMinor: number;
}

/** A room hold (HTL-16, HTL-18): the saved `pending_payment` reservation. */
export interface HotelHold {
  reservationId: string;
  status: 'pending_payment';
  hotelId: string;
  hotelName: string;
  /** `YYYY-MM-DD`. */
  checkInDate: string;
  /** `YYYY-MM-DD`; not charged. */
  checkOutDate: string;
  nights: number;
  rooms: HeldRoom[];
  totalMinor: number;
  currency: string;
  /** The hotel's policy as it was at hold time (PAY-02, HTL-21). */
  policy: {
    cancellationTiers: { daysBefore: number; refundPercent: number }[];
    checkInTime: string;
    checkOutTime: string;
  };
  /** When the hold ends if unpaid: 10 minutes after the reservation was created. */
  holdExpiresAt: Date;
}

export const HotelReservationGroup = {
  UPCOMING: 'upcoming',
  PAST: 'past',
  CANCELLED: 'cancelled',
} as const;
export type HotelReservationGroup =
  (typeof HotelReservationGroup)[keyof typeof HotelReservationGroup];

export interface ListMyHotelReservationsQuery {
  group?: HotelReservationGroup;
  page?: number;
  limit?: number;
}

export interface HotelReservationPolicyView {
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
  checkInTime: string;
  checkOutTime: string;
}

export interface HotelReservationCancellationView {
  cancelledAt: Date;
  cancelledBy: CancelledBy;
  refundPercent: number;
  refundAmountMinor: number;
}

/** One item in the owner's paginated reservation list (HTL-20). */
export interface HotelReservationSummaryView {
  _id: string;
  /** Set only on confirmation (HTL-17); never generated on read. */
  reference?: string;
  status: HotelReservationStatus;
  hotelId: string;
  hotelName: string;
  /** `YYYY-MM-DD`. */
  checkInDate: string;
  /** `YYYY-MM-DD`. */
  checkOutDate: string;
  nights: number;
  rooms: HeldRoom[];
  totalMinor: number;
  currency: string;
}

/** Full customer-facing details for a single reservation (HTL-20). */
export interface HotelReservationDetailView extends HotelReservationSummaryView {
  policy: HotelReservationPolicyView;
  holdExpiresAt: Date;
  confirmedAt?: Date;
  expiredAt?: Date;
  completedAt?: Date;
  cancellation?: HotelReservationCancellationView;
  createdAt: Date;
  updatedAt: Date;
}
