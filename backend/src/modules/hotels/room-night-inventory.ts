import { Injectable, NotImplementedException } from '@nestjs/common';
import type { HotelTransactionOptions, RoomDateRange } from './hotels.types.js';

/** The only writer of room-night inventory (data-model section 4.2). */
@Injectable()
export class RoomNightInventory {
  /** Check-out is exclusive. Any unavailable room rejects the whole request with ROOMS_UNAVAILABLE. */
  reserve(
    hotelId: string,
    roomIds: string[],
    checkIn: Date,
    checkOut: Date,
    reservationId: string,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void hotelId;
    void roomIds;
    void checkIn;
    void checkOut;
    void reservationId;
    void options;
    throw new NotImplementedException('reserve: implemented in INV-02');
  }

  /** Releases only this reservation's nights; safe to repeat. */
  release(
    reservationId: string,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void reservationId;
    void options;
    throw new NotImplementedException('release: implemented in INV-02');
  }

  /** Inclusive dates; returns the blockId used by unblock. Overlaps throw OVERLAPS_RESERVATION_OR_BLOCK. */
  block(
    roomId: string,
    fromDate: Date,
    toDate: Date,
    options?: HotelTransactionOptions,
  ): Promise<string> {
    void roomId;
    void fromDate;
    void toDate;
    void options;
    throw new NotImplementedException('block: implemented in INV-02');
  }

  unblock(blockId: string, options?: HotelTransactionOptions): Promise<void> {
    void blockId;
    void options;
    throw new NotImplementedException('unblock: implemented in INV-02');
  }

  /** Sorts and merges adjacent ranges; rejects overlaps and removal of future reserved nights. */
  setAvailability(
    roomId: string,
    ranges: RoomDateRange[],
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void roomId;
    void ranges;
    void options;
    throw new NotImplementedException('setAvailability: implemented in INV-02');
  }

  /** Rejects reservation nights from today onward with ROOM_HAS_RESERVATIONS. */
  deactivate(roomId: string, options?: HotelTransactionOptions): Promise<void> {
    void roomId;
    void options;
    throw new NotImplementedException('deactivate: implemented in INV-02');
  }

  /** Also rejects previously reserved rooms with ROOM_WAS_RESERVED. */
  delete(roomId: string, options?: HotelTransactionOptions): Promise<void> {
    void roomId;
    void options;
    throw new NotImplementedException('delete: implemented in INV-02');
  }
}
