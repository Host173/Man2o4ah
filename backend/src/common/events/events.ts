/**
 * Every in-process event of the platform (data-model §6.3). Always emit and
 * listen with `Events.X`, never with a string literal. A new event is a
 * contract change.
 */
export const Events = {
  PaymentSucceeded: 'payment.succeeded',
  FlightBookingExpired: 'flight-booking.expired',
  HotelReservationExpired: 'hotel-reservation.expired',
  FlightBookingConfirmed: 'flight-booking.confirmed',
  FlightBookingCancelled: 'flight-booking.cancelled',
  HotelReservationConfirmed: 'hotel-reservation.confirmed',
  HotelReservationCancelled: 'hotel-reservation.cancelled',
  RefundUpdated: 'refund.updated',
  FlightRescheduled: 'flight.rescheduled',
  FlightBookingRescheduled: 'flight-booking.rescheduled',
  FlightCancelled: 'flight.cancelled',
  UserDeactivated: 'user.deactivated',
  UserReactivated: 'user.reactivated',
  AccountSuspended: 'account.suspended',
  AccountReactivated: 'account.reactivated',
  ProviderDeactivated: 'provider.deactivated',
  ProviderReactivated: 'provider.reactivated',
  ModeratorInvited: 'moderator.invited',
  AdminAction: 'admin.action',
} as const;
export type EventName = (typeof Events)[keyof typeof Events];
