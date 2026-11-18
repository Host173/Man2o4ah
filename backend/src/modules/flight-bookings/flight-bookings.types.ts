import type { CabinClass } from '../../common/database/cabin-class.js';
import type {
  FlightBookingStatus,
  PassengerType,
  SegmentDirection,
  TripType,
} from './schemas/flight-booking.schema.js';

/**
 * Internal service input for the admin booking list (ACC-17), not an HTTP DTO.
 * `from` and `to` filter on the booking's `createdAt`, both ends inclusive.
 */
export interface AdminFlightBookingQuery {
  status?: FlightBookingStatus;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

/** One row of the admin booking list (ACC-17). Read-only; amounts in minor units. */
export interface FlightBookingAdminView {
  bookingType: 'flight';
  bookingId: string;
  /** Set only once the booking is confirmed (FLT-23). */
  reference?: string;
  userId: string;
  /** The outbound segment's airline. */
  providerId: string;
  /** Outbound departure (`firstDepartureAt`). */
  startAt: Date;
  /** Last segment's departure (`lastDepartureAt`). */
  endAt: Date;
  totalMinor: number;
  currency: string;
  status: FlightBookingStatus;
  createdAt: Date;
}

/** The airline's policies a segment snapshots at quote/hold time (same fields as `SegmentPolicy`). */
export interface QuotedSegmentPolicy {
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
  freeBags: number;
  maxBagWeightKg: number;
  /** 0 when the airline sells no extra bags. */
  extraBagPriceMinor: number;
  maxExtraBagsPerPassenger: number;
}

/** One priced segment of a quote; the same fields FLT-22 saves as a `FlightSegment`. */
export interface QuotedSegment {
  direction: SegmentDirection;
  flightId: string;
  cabinId: string;
  cabinClass: CabinClass;
  airlineId: string;
  airlineName: string;
  flightNumber: string;
  departureAirportId: string;
  arrivalAirportId: string;
  /** UTC instants. */
  departureAt: Date;
  arrivalAt: Date;
  /** Price per seat right now. */
  fareMinor: number;
  policy: QuotedSegmentPolicy;
}

/** One passenger as entered; `dateOfBirth` stays `YYYY-MM-DD`. */
export interface QuotedPassenger {
  type: PassengerType;
  fullName: string;
  dateOfBirth: string;
  documentNumber: string;
  extraBagCount: number;
  extraBagWeightKg?: number;
}

/** The booking summary shown before payment (FLT-19, FLT-21). Nothing is saved. */
export interface FlightQuote {
  tripType: TripType;
  /** Adults + children; infants take no seat. */
  seatCount: number;
  segments: QuotedSegment[];
  passengers: QuotedPassenger[];
  pricing: {
    fareTotalMinor: number;
    baggageTotalMinor: number;
    totalMinor: number;
    currency: string;
  };
}
