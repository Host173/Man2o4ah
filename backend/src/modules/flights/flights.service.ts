import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  AirlineView,
  BookabilityResult,
  FlightSearchItem,
  FlightWithAirline,
  OneWaySearchQuery,
  RoundTripSearchQuery,
  RoundTripSearchResult,
  SearchFlightsQuery,
} from './flights.types.js';

/**
 * What other modules may ask of flights (CTR-02). Seat counters are never
 * changed here: that is `SeatInventory`. Getters return `null`, or leave the
 * key out of the `Map`, when something isn't found: the caller decides
 * between 400 and 404.
 */
@Injectable()
export class FlightsService {
  /**
   * Flights with their airlines, by flight ID, for pricing and snapshots (FLT-19, FLT-22, FLT-29).
   * Unknown IDs are left out. Cancelled flights and inactive airlines are still returned:
   * ask `checkBookable` whether they can be booked. Implemented in FLT-17.
   */
  getFlightsForBooking(
    flightIds: string[],
  ): Promise<Map<string, FlightWithAirline>> {
    void flightIds;
    throw new NotImplementedException(
      'getFlightsForBooking: implemented in FLT-17',
    );
  }

  /**
   * Can `seats` seats of this cabin be booked now? Airline active, flight `scheduled`,
   * departure in the future and enough available seats. The seat check is advisory:
   * only `SeatInventory.hold` is atomic. Never throws for a business reason. Implemented in FLT-17.
   */
  checkBookable(
    flightId: string,
    cabinId: string,
    seats: number,
  ): Promise<BookabilityResult> {
    void flightId;
    void cabinId;
    void seats;
    throw new NotImplementedException('checkBookable: implemented in FLT-17');
  }

  /**
   * Search bookable flights (FLT-11, FLT-12, FLT-15). One-way returns one paginated list;
   * with `returnDate` it returns `{ outbound, inbound }`, each paginated. No match is
   * `items: []`, not an error. Throws 400 `VALIDATION_FAILED` if `minPriceMinor > maxPriceMinor`.
   * Implemented in FLT-11.
   */
  search(query: OneWaySearchQuery): Promise<Paginated<FlightSearchItem>>;
  search(query: RoundTripSearchQuery): Promise<RoundTripSearchResult>;
  search(
    query: SearchFlightsQuery,
  ): Promise<Paginated<FlightSearchItem> | RoundTripSearchResult>;
  search(
    query: SearchFlightsQuery,
  ): Promise<Paginated<FlightSearchItem> | RoundTripSearchResult> {
    void query;
    throw new NotImplementedException('search: implemented in FLT-11');
  }

  /** One airline by ID, or `null` (ACC-13). Implemented in FLT-01. */
  getAirline(airlineId: string): Promise<AirlineView | null> {
    void airlineId;
    throw new NotImplementedException('getAirline: implemented in FLT-01');
  }

  /**
   * Activate or deactivate an airline (ACC-15) and return it. Idempotent.
   * Throws 404 `NOT_FOUND` if it doesn't exist. Implemented in FLT-01.
   */
  setAirlineActive(airlineId: string, isActive: boolean): Promise<AirlineView> {
    void airlineId;
    void isActive;
    throw new NotImplementedException(
      'setAirlineActive: implemented in FLT-01',
    );
  }
}
