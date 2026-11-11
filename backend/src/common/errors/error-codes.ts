/**
 * The one list of error codes. Keys are PascalCase in code
 * (`ErrorCode.SeatsUnavailable`); values are UPPER_SNAKE on the wire.
 * A new code is added here and to the list in
 * docs/ai/skills/travel-platform/references/api-contract.md §3
 * in the same PR that first uses it.
 */
export const ErrorCode = {
  ValidationFailed: 'VALIDATION_FAILED',
  NotAuthenticated: 'NOT_AUTHENTICATED',
  TokenExpired: 'TOKEN_EXPIRED',
  SessionExpired: 'SESSION_EXPIRED',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  AccountLocked: 'ACCOUNT_LOCKED',
  AccountSuspended: 'ACCOUNT_SUSPENDED',
  PasswordChangeRequired: 'PASSWORD_CHANGE_REQUIRED',
  ForbiddenRole: 'FORBIDDEN_ROLE',
  NotFound: 'NOT_FOUND',
  EmailTaken: 'EMAIL_TAKEN',
  SeatsUnavailable: 'SEATS_UNAVAILABLE',
  RoomsUnavailable: 'ROOMS_UNAVAILABLE',
  CapacityBelowReserved: 'CAPACITY_BELOW_RESERVED',
  ConcurrentChange: 'CONCURRENT_CHANGE',
  AvailabilityHasReservations: 'AVAILABILITY_HAS_RESERVATIONS',
  RoomHasReservations: 'ROOM_HAS_RESERVATIONS',
  RoomWasReserved: 'ROOM_WAS_RESERVED',
  OverlapsReservationOrBlock: 'OVERLAPS_RESERVATION_OR_BLOCK',
  HoldExpired: 'HOLD_EXPIRED',
  InvalidStatusTransition: 'INVALID_STATUS_TRANSITION',
  PoliciesNotAccepted: 'POLICIES_NOT_ACCEPTED',
  BadSignature: 'BAD_SIGNATURE',
  UnsupportedCurrency: 'UNSUPPORTED_CURRENCY',
  RatesUnavailable: 'RATES_UNAVAILABLE',
  AlreadyReported: 'ALREADY_REPORTED',
  AlreadyReviewed: 'ALREADY_REVIEWED',
  ActiveBookingsExist: 'ACTIVE_BOOKINGS_EXIST',
  LimitExceeded: 'LIMIT_EXCEEDED',
  InventoryCorrupted: 'INVENTORY_CORRUPTED',
  Conflict: 'CONFLICT',
  RequestFailed: 'REQUEST_FAILED',
  InternalError: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
