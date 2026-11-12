import type { ClientSession } from 'mongoose';
import type { CancellationPolicy } from '../../common/database/cancellation-policy.schema.js';
import type { RatingSummary } from './schemas/hotel.schema.js';

/** Pass the caller's transaction to every read and inventory write in a hold. */
export interface HotelTransactionOptions {
  session: ClientSession;
}

export interface RoomDateRange {
  fromDate: Date;
  toDate: Date;
}

export interface HotelView {
  id: string;
  name: string;
  address: string;
  cityId: string;
  countryCode: string;
  description?: string;
  photos: { id: string; key: string }[];
  starRating?: number;
  amenities: string[];
  checkInTime: string;
  checkOutTime: string;
  cancellationPolicy: CancellationPolicy;
  isActive: boolean;
  ratingSummary: RatingSummary;
}

export interface RoomView {
  id: string;
  hotelId: string;
  name: string;
  type: string;
  beds: number;
  maxOccupancy: number;
  pricePerNightMinor: number;
  isActive: boolean;
  /** Bookable nights, both ends inclusive. */
  availability: RoomDateRange[];
  hasEverBeenReserved: boolean;
}

export type RoomNightView = {
  roomId: string;
  hotelId: string;
  date: Date;
} & (
  | { kind: 'reservation'; reservationId: string }
  | { kind: 'blocked'; blockId: string }
);

/** Internal service input, not an HTTP DTO. Dates are UTC DateOnly values. */
export interface HotelSearchQuery {
  cityId?: string;
  countryCode?: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  rooms?: number;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  minRating?: number;
  sortBy?: 'price' | 'rating';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface HotelSearchResult extends HotelView {
  /** The cheapest qualifying room's price, not the total stay price. */
  pricePerNightMinor: number;
}
