import type { Events } from '../../common/events/events.js';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import { NotificationType } from './schemas/notification.schema.js';

type ProviderType = PayloadOf<
  typeof Events.ProviderDeactivated
>['providerType'];
type RefundStatus = PayloadOf<typeof Events.RefundUpdated>['status'];

/** A notification about to be stored; `userId` is a string as events carry it. */
export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entity?: { type: string; id: string };
  eventId?: string;
}

export type BookingKind = 'flight' | 'hotel';

const BOOKING_LABEL: Record<BookingKind, string> = {
  flight: 'flight booking',
  hotel: 'hotel reservation',
};

const BOOKING_TITLE: Record<BookingKind, string> = {
  flight: 'Flight booking',
  hotel: 'Hotel reservation',
};

const BOOKING_ENTITY: Record<BookingKind, string> = {
  flight: 'flight_booking',
  hotel: 'hotel_reservation',
};

const REFUND_MESSAGE: Record<RefundStatus, string> = {
  pending: 'Your refund is being processed.',
  refunded: 'Your refund is complete.',
  failed: 'Your refund failed. Please contact support.',
};

const PROVIDER_TITLE: Record<ProviderType, string> = {
  airline: 'Airline',
  hotel: 'Hotel',
};

/** `flight-booking.confirmed` and `hotel-reservation.confirmed`. */
export function bookingConfirmed(
  kind: BookingKind,
  payload: PayloadOf<
    | typeof Events.FlightBookingConfirmed
    | typeof Events.HotelReservationConfirmed
  >,
): NewNotification[] {
  return [
    {
      userId: payload.userId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: `${BOOKING_TITLE[kind]} confirmed`,
      message: `Your ${BOOKING_LABEL[kind]} ${payload.reference} is confirmed.`,
      entity: { type: BOOKING_ENTITY[kind], id: payload.bookingId },
    },
  ];
}

/** `flight-booking.cancelled` and `hotel-reservation.cancelled`. */
export function bookingCancelled(
  kind: BookingKind,
  payload: PayloadOf<
    | typeof Events.FlightBookingCancelled
    | typeof Events.HotelReservationCancelled
  >,
): NewNotification[] {
  return [
    {
      userId: payload.userId,
      type: NotificationType.BOOKING_CANCELLED,
      title: `${BOOKING_TITLE[kind]} cancelled`,
      message: `Your ${BOOKING_LABEL[kind]} ${payload.reference} was cancelled.`,
      entity: { type: BOOKING_ENTITY[kind], id: payload.bookingId },
    },
  ];
}

/** `refund.updated`. */
export function refundUpdated(
  payload: PayloadOf<typeof Events.RefundUpdated>,
): NewNotification[] {
  return [
    {
      userId: payload.userId,
      type: NotificationType.REFUND_UPDATED,
      title: 'Refund update',
      message: REFUND_MESSAGE[payload.status],
      entity: { type: 'refund', id: payload.refundId },
    },
  ];
}

/** `flight-booking.rescheduled`. */
export function flightBookingRescheduled(
  payload: PayloadOf<typeof Events.FlightBookingRescheduled>,
): NewNotification[] {
  return [
    {
      userId: payload.userId,
      type: NotificationType.FLIGHT_SCHEDULE_CHANGED,
      eventId: payload.eventId,
      title: 'Flight schedule changed',
      message:
        'A flight in your booking has new times. Check your booking for the new schedule.',
      entity: { type: 'flight_booking', id: payload.bookingId },
    },
  ];
}

/** `account.suspended`. */
export function accountSuspended(
  payload: PayloadOf<typeof Events.AccountSuspended>,
): NewNotification[] {
  return [
    {
      userId: payload.userId,
      type: NotificationType.ACCOUNT_SUSPENDED,
      eventId: payload.eventId,
      title: 'Account suspended',
      message: 'Your account was suspended by an administrator.',
    },
  ];
}

/** `account.reactivated`. */
export function accountReactivated(
  payload: PayloadOf<typeof Events.AccountReactivated>,
): NewNotification[] {
  return [
    {
      userId: payload.userId,
      type: NotificationType.ACCOUNT_REACTIVATED,
      eventId: payload.eventId,
      title: 'Account reactivated',
      message: 'Your account is active again.',
    },
  ];
}

/** `provider.deactivated`: one notification per moderator of the provider. */
export function providerDeactivated(
  payload: PayloadOf<typeof Events.ProviderDeactivated>,
): NewNotification[] {
  return payload.moderatorIds.map((userId) => ({
    userId,
    type: NotificationType.PROVIDER_DEACTIVATED,
    eventId: payload.eventId,
    title: `${PROVIDER_TITLE[payload.providerType]} deactivated`,
    message: `Your ${payload.providerType} was deactivated by an administrator.`,
    entity: { type: payload.providerType, id: payload.providerId },
  }));
}

/** `provider.reactivated`: one notification per moderator of the provider. */
export function providerReactivated(
  payload: PayloadOf<typeof Events.ProviderReactivated>,
): NewNotification[] {
  return payload.moderatorIds.map((userId) => ({
    userId,
    type: NotificationType.PROVIDER_REACTIVATED,
    eventId: payload.eventId,
    title: `${PROVIDER_TITLE[payload.providerType]} reactivated`,
    message: `Your ${payload.providerType} is active again.`,
    entity: { type: payload.providerType, id: payload.providerId },
  }));
}
