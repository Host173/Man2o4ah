import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  HotelSearchQuery,
  HotelSearchResult,
  HotelTransactionOptions,
  HotelView,
  RoomNightView,
  RoomView,
} from './hotels.types.js';
import type { RatingSummary } from './schemas/hotel.schema.js';

@Injectable()
export class HotelsService {
  /** Includes inactive hotels; the caller checks bookability. Missing IDs return null. */
  getHotel(
    hotelId: string,
    options?: HotelTransactionOptions,
  ): Promise<HotelView | null> {
    void hotelId;
    void options;
    throw new NotImplementedException('getHotel: implemented in HTL-01');
  }

  /** Includes inactive rooms for booking validation and moderator views. */
  getRooms(
    hotelId: string,
    options?: HotelTransactionOptions,
  ): Promise<RoomView[]> {
    void hotelId;
    void options;
    throw new NotImplementedException('getRooms: implemented in HTL-03');
  }

  /** Taken nights in the inclusive date range, for HTL-08's room status view. */
  getRoomNights(
    hotelId: string,
    fromDate: Date,
    toDate: Date,
    options?: HotelTransactionOptions,
  ): Promise<RoomNightView[]> {
    void hotelId;
    void fromDate;
    void toDate;
    void options;
    throw new NotImplementedException('getRoomNights: implemented in INV-02');
  }

  search(query: HotelSearchQuery): Promise<Paginated<HotelSearchResult>> {
    void query;
    throw new NotImplementedException('search: implemented in HTL-11');
  }

  /** Writes the summary computed by hotel-bookings; missing hotels throw NOT_FOUND. */
  setRatingSummary(
    hotelId: string,
    summary: RatingSummary,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void hotelId;
    void summary;
    void options;
    throw new NotImplementedException(
      'setRatingSummary: implemented in HTL-01',
    );
  }

  /** ACC-15: existing reservations are not changed. Missing hotels throw NOT_FOUND. */
  setActive(
    hotelId: string,
    isActive: boolean,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void hotelId;
    void isActive;
    void options;
    throw new NotImplementedException('setActive: implemented in HTL-01');
  }
}
