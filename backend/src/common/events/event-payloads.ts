import type { BookingType } from '../database/booking-type.js';
import type { AuditAction } from '../../modules/audit/schemas/audit-log.schema.js';
import type { ProviderType } from '../../modules/accounts/schemas/user.schema.js';
import type { RefundStatus } from '../../modules/payments/schemas/refund.schema.js';
import type { EventName, Events } from './events.js';

// Payload shapes of the events in `Events`. IDs are strings (`id.toString()`),
// times are `Date`. A new payload field is a contract change.

/** Emitted by payments; handled by flight-bookings and hotel-bookings. */
export interface PaymentSucceededEvent {
  bookingType: BookingType;
  bookingId: string;
}

/** Emitted by flight-bookings and hotel-bookings; handled by payments. */
export interface BookingExpiredEvent {
  bookingId: string;
  userId: string;
}

/** Emitted by flight-bookings and hotel-bookings; handled by notifications. */
export interface BookingStatusEvent {
  bookingId: string;
  userId: string;
  reference: string;
}

/** Emitted by payments; handled by notifications. */
export interface RefundUpdatedEvent {
  refundId: string;
  userId: string;
  status: RefundStatus;
}

/** Emitted by flights; handled by flight-bookings. */
export interface FlightRescheduledEvent {
  flightId: string;
  departureAt: Date;
  arrivalAt: Date;
}

/** Emitted by flight-bookings; handled by notifications. */
export interface FlightBookingRescheduledEvent {
  bookingId: string;
  userId: string;
}

/** Emitted by flights; handled by flight-bookings. */
export interface FlightCancelledEvent {
  flightId: string;
}

/** Emitted by accounts; handled by blog, itineraries (deactivation) and notifications (suspension). */
export interface UserStatusEvent {
  userId: string;
}

/** Emitted by admin; handled by notifications. */
export interface ProviderStatusEvent {
  providerType: ProviderType;
  providerId: string;
  moderatorIds: string[];
}

/** Emitted by admin and moderation; handled by audit. */
export interface AdminActionEvent {
  actorId: string;
  action: AuditAction;
  target: { type: string; id: string };
  details?: Record<string, unknown>;
}

/** The payload of every event, by event name. Exactly one entry per event. */
export interface EventPayloads {
  [Events.PaymentSucceeded]: PaymentSucceededEvent;
  [Events.FlightBookingExpired]: BookingExpiredEvent;
  [Events.HotelReservationExpired]: BookingExpiredEvent;
  [Events.FlightBookingConfirmed]: BookingStatusEvent;
  [Events.FlightBookingCancelled]: BookingStatusEvent;
  [Events.HotelReservationConfirmed]: BookingStatusEvent;
  [Events.HotelReservationCancelled]: BookingStatusEvent;
  [Events.RefundUpdated]: RefundUpdatedEvent;
  [Events.FlightRescheduled]: FlightRescheduledEvent;
  [Events.FlightBookingRescheduled]: FlightBookingRescheduledEvent;
  [Events.FlightCancelled]: FlightCancelledEvent;
  [Events.UserDeactivated]: UserStatusEvent;
  [Events.UserReactivated]: UserStatusEvent;
  [Events.AccountSuspended]: UserStatusEvent;
  [Events.AccountReactivated]: UserStatusEvent;
  [Events.ProviderDeactivated]: ProviderStatusEvent;
  [Events.ProviderReactivated]: ProviderStatusEvent;
  [Events.AdminAction]: AdminActionEvent;
}

export type PayloadOf<K extends EventName> = EventPayloads[K];
