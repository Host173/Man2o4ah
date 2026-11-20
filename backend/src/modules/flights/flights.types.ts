import type { ClientSession } from 'mongoose';
import type { CabinClass } from '../../common/database/cabin-class.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import type { FlightStatus } from './schemas/flight.schema.js';

/*
 * The contract types of the flights module (CTR-02). Views are plain objects:
 * IDs are strings, never ObjectIds, so other modules and the fakes don't
 * depend on Mongoose. The service maps documents to these views.
 */

// ---------------------------------------------------------------- views

/** One cabin of a flight, with its four seat counters (data-model 3.3). */
export interface CabinView {
  id: string;
  cabinClass: CabinClass;
  /** Always `totalSeats = availableSeats + heldSeats + bookedSeats`. */
  totalSeats: number;
  availableSeats: number;
  heldSeats: number;
  bookedSeats: number;
  /** Per seat, whole cents. */
  priceMinor: number;
  /** Free bags per passenger. */
  freeBags: number;
  maxBagWeightKg: number;
}

/** One cancellation tier: the refund percent that applies from `daysBefore` days out. */
export interface CancellationTierView {
  daysBefore: number;
  refundPercent: number;
}

/** Extra-bag rules of an airline (FLT-08). */
export interface BaggagePolicyView {
  /** `null` when the airline does not sell extra bags. */
  extraBagPriceMinor: number | null;
  maxExtraBagsPerPassenger: number;
}

/** An airline with the policies a booking snapshots (data-model 3.3). */
export interface AirlineView {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  logo?: AirlineLogoView;
  baggagePolicy: BaggagePolicyView;
  cancellationTiers: CancellationTierView[];
}

/** Public logo information; storage keys are not exposed in service views. */
export interface AirlineLogoView {
  id: string;
  url: string;
}

/** A flight with all its cabins. Times are UTC instants. */
export interface FlightView {
  id: string;
  airlineId: string;
  flightNumber: string;
  departureAirportId: string;
  arrivalAirportId: string;
  departureAt: Date;
  arrivalAt: Date;
  /** `YYYY-MM-DD` at the departure airport. */
  departureLocalDate: string;
  durationMinutes: number;
  status: FlightStatus;
  hasBookings: boolean;
  cabins: CabinView[];
}

/** A flight-management response includes the airport zones needed to display its UTC instants locally. */
export interface FlightManagementView extends FlightView {
  departureTimeZone: string;
  arrivalTimeZone: string;
}

/** Flight fields supplied by an airline moderator; the airline ID comes from authentication. */
export interface CreateFlightInput {
  flightNumber: string;
  departureAirportId: string;
  arrivalAirportId: string;
  departureLocal: string;
  arrivalLocal: string;
}

/** Cabin fields supplied by an airline moderator when adding a cabin to a flight. */
export interface AddCabinInput {
  cabinClass: CabinClass;
  totalSeats: number;
  priceMinor: number;
  freeBags: number;
  maxBagWeightKg: number;
}

/** Optional fields supplied when an airline moderator edits a scheduled flight. */
export interface UpdateFlightInput {
  departureAirportId?: string;
  arrivalAirportId?: string;
  departureLocal?: string;
  arrivalLocal?: string;
}

/** Optional cabin fields an airline moderator may edit (FLT-05). */
export interface UpdateCabinInput {
  priceMinor?: number;
  totalSeats?: number;
}

/** Pagination for a moderator's own-airline flight list. */
export interface FlightListQuery {
  page: number;
  limit: number;
}

/** A flight together with its airline: everything a booking needs to price and snapshot a segment. */
export interface FlightWithAirline {
  flight: FlightView;
  airline: AirlineView;
}

// ------------------------------------------------------- bookability

/** Why a flight/cabin cannot be booked right now. */
export type BookabilityProblem =
  | 'flight_not_found'
  | 'cabin_not_found'
  | 'airline_inactive'
  | 'flight_not_scheduled'
  | 'departure_passed'
  | 'not_enough_seats';

/** Result of `FlightsService.checkBookable`. */
export type BookabilityResult =
  { bookable: true } | { bookable: false; reason: BookabilityProblem };

// ------------------------------------------------------------ search

export type FlightSortBy = 'price' | 'duration' | 'departure';

/** What every flight search needs (FLT-11, FLT-15). */
export interface SearchFlightsBase {
  /** Departure airport code, e.g. `CAI`. */
  from: string;
  /** Arrival airport code. */
  to: string;
  /** Departure date at the departure airport, `YYYY-MM-DD`. */
  date: string;
  adults: number;
  children: number;
  /** Infants take no seat, so they never affect availability. */
  infants: number;
  cabinClass?: CabinClass;
  /** Inclusive, whole cents, applied to a cabin's `priceMinor`. */
  minPriceMinor?: number;
  maxPriceMinor?: number;
  sortBy: FlightSortBy;
  /** 1-based. */
  page: number;
  limit: number;
}

export interface OneWaySearchQuery extends SearchFlightsBase {
  returnDate?: undefined;
}

/** `returnDate` makes it a round trip (FLT-12): the return leg flies `to` → `from` on that date. */
export interface RoundTripSearchQuery extends SearchFlightsBase {
  returnDate: string;
}

export type SearchFlightsQuery = OneWaySearchQuery | RoundTripSearchQuery;

/** One flight in the results, with the cabins that matched the query. */
export interface FlightSearchItem {
  flight: FlightView;
  airline: AirlineView;
  /** Cabins with enough seats, the requested class and a price in range; cheapest first. Never empty. */
  matchingCabins: CabinView[];
}

/** A round-trip search returns one paginated list per direction. */
export interface RoundTripSearchResult {
  outbound: Paginated<FlightSearchItem>;
  inbound: Paginated<FlightSearchItem>;
}

// --------------------------------------------------- seat inventory

/** `seats` seats of one cabin of one flight. */
export interface SeatItem {
  flightId: string;
  cabinId: string;
  seats: number;
}

/** The caller's transaction. Every inventory method runs inside it (data-model 4.1). */
export interface InventoryOptions {
  session: ClientSession;
}
