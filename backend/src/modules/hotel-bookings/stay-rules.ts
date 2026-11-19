import type { ErrorDetail } from '../../common/errors/error-body.js';

/** What the rules need from the hotel. */
export interface RuleHotel {
  isActive: boolean;
}

/** What the rules need from one of the hotel's rooms (from `HotelsService.getRooms`). */
export interface RuleRoom {
  id: string;
  isActive: boolean;
  maxOccupancy: number;
}

/** One room the user asks for, with its guests. */
export interface RequestedRoom {
  roomId: string;
  adults: number;
  /** Ages 0-17, checked by the DTO. */
  childAges: readonly number[];
}

/**
 * The stay as the user entered it. A date is `undefined` when the one entered
 * doesn't exist (the caller reports that), so the date rules are skipped.
 */
export interface StayRequest {
  checkInDate?: Date;
  checkOutDate?: Date;
  rooms: readonly RequestedRoom[];
}

/**
 * Every stay and guest rule of HTL-16 and HTL-18 that the request and the
 * hotel's data can decide, checked at once. Room availability is not checked
 * here: `RoomNightInventory.reserve` does that atomically (409 ROOMS_UNAVAILABLE).
 * `hotelRooms` are this hotel's rooms; `today` is the current UTC date (DateOnly).
 * Returns one `{ field, message }` per broken rule, for 400 VALIDATION_FAILED
 * `details` (GEN-02); an empty list means the stay is valid.
 */
export function checkStay(
  stay: StayRequest,
  hotel: RuleHotel | null,
  hotelRooms: readonly RuleRoom[],
  today: Date,
): ErrorDetail[] {
  // Without the hotel there is nothing to check the rooms against.
  if (hotel === null) {
    return [{ field: 'hotelId', message: 'This hotel does not exist' }];
  }

  const errors: ErrorDetail[] = [];
  if (!hotel.isActive) {
    errors.push({
      field: 'hotelId',
      message: 'This hotel is not taking bookings',
    });
  }

  const { checkInDate, checkOutDate } = stay;
  if (checkInDate !== undefined && checkInDate < today) {
    errors.push({
      field: 'checkInDate',
      message: 'Check-in cannot be in the past',
    });
  }
  if (
    checkInDate !== undefined &&
    checkOutDate !== undefined &&
    checkOutDate <= checkInDate
  ) {
    errors.push({
      field: 'checkOutDate',
      message: 'Check-out must be after check-in',
    });
  }

  const adults = stay.rooms.reduce((sum, room) => sum + room.adults, 0);
  if (adults === 0) {
    errors.push({
      field: 'rooms',
      message: 'At least one adult is required',
    });
  }

  const roomsById = new Map(hotelRooms.map((room) => [room.id, room]));
  const seen = new Set<string>();
  stay.rooms.forEach((requested, i) => {
    const at = `rooms[${i}]`;
    const room = roomsById.get(requested.roomId);

    if (seen.has(requested.roomId)) {
      errors.push({
        field: `${at}.roomId`,
        message: 'This room is already in the reservation',
      });
    } else if (room === undefined) {
      errors.push({
        field: `${at}.roomId`,
        message: 'This room is not in this hotel',
      });
    } else if (!room.isActive) {
      errors.push({
        field: `${at}.roomId`,
        message: 'This room is not available for booking',
      });
    }
    seen.add(requested.roomId);

    const guests = requested.adults + requested.childAges.length;
    if (guests === 0) {
      errors.push({
        field: at,
        message: 'Every room needs at least one guest',
      });
    } else if (room !== undefined && guests > room.maxOccupancy) {
      errors.push({
        field: at,
        message: `This room sleeps at most ${room.maxOccupancy}`,
      });
    }
  });

  return errors;
}
