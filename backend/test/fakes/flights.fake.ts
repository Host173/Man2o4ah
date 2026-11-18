import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import { convertFlightTimes } from '../../src/modules/flights/flight-time.js';
import type { FlightsService } from '../../src/modules/flights/flights.service.js';
import type { ReferenceDataService } from '../../src/modules/reference-data/reference-data.service.js';
import type {
  AirlineView,
  BookabilityResult,
  CabinView,
  CreateFlightInput,
  FlightListQuery,
  FlightManagementView,
  FlightSearchItem,
  FlightView,
  FlightWithAirline,
  OneWaySearchQuery,
  RoundTripSearchQuery,
  RoundTripSearchResult,
  SearchFlightsBase,
  SearchFlightsQuery,
} from '../../src/modules/flights/flights.types.js';
import { FakeFlightsData } from './flights-data.fake.js';
import { FakeReferenceDataService } from './reference-data.fake.js';
import type { PublicApi } from './public-api.js';

/**
 * A working `FlightsService` over the flights you seed in `data`. Share the same
 * `FakeFlightsData` with a `FakeSeatInventory` and holds change what search
 * and `checkBookable` see. Everything it returns is a copy.
 */
export class FakeFlightsService implements PublicApi<FlightsService> {
  private nextFlightId = 1;

  constructor(
    readonly data: FakeFlightsData = new FakeFlightsData(),
    private readonly referenceData: Pick<
      ReferenceDataService,
      'getAirports'
    > = new FakeReferenceDataService(),
  ) {}

  async createFlight(
    input: CreateFlightInput,
    airlineId: string,
  ): Promise<FlightManagementView> {
    if (!this.data.airline(airlineId)) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Airline not found',
      });
    }

    const flightNumber = input.flightNumber.trim().toUpperCase();
    if (!flightNumber) {
      throw invalid('flightNumber', 'must not be blank');
    }
    const departureAirportId = input.departureAirportId.trim().toUpperCase();
    const arrivalAirportId = input.arrivalAirportId.trim().toUpperCase();
    if (departureAirportId === arrivalAirportId) {
      throw invalid('arrivalAirportId', 'must differ from departureAirportId');
    }

    const airports = await this.referenceData.getAirports([
      departureAirportId,
      arrivalAirportId,
    ]);
    const departureAirport = airports.get(departureAirportId);
    if (!departureAirport) {
      throw invalid('departureAirportId', 'is not a known airport');
    }
    const arrivalAirport = airports.get(arrivalAirportId);
    if (!arrivalAirport) {
      throw invalid('arrivalAirportId', 'is not a known airport');
    }
    const times = convertFlightTimes(
      input.departureLocal,
      departureAirport.timeZone,
      input.arrivalLocal,
      arrivalAirport.timeZone,
    );

    if (
      this.data
        .flights()
        .some(
          (flight) =>
            flight.airlineId === airlineId &&
            flight.flightNumber.trim().toUpperCase() === flightNumber &&
            flight.departureLocalDate === times.departureLocalDate,
        )
    ) {
      throw new ConflictException({
        code: ErrorCode.Conflict,
        message: 'A flight with this number already exists on this local date',
      });
    }

    const flight = this.data.addFlight({
      id: this.newFlightId(),
      airlineId,
      flightNumber,
      departureAirportId,
      arrivalAirportId,
      departureAt: times.departureAt,
      arrivalAt: times.arrivalAt,
      departureLocalDate: times.departureLocalDate,
      cabins: [],
    });
    return {
      ...flight,
      departureTimeZone: departureAirport.timeZone,
      arrivalTimeZone: arrivalAirport.timeZone,
    };
  }

  async listAirlineFlights(
    airlineId: string,
    query: FlightListQuery,
  ): Promise<Paginated<FlightManagementView>> {
    if (!this.data.airline(airlineId)) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Airline not found',
      });
    }

    const flights = this.data
      .flights()
      .filter((flight) => flight.airlineId === airlineId)
      .sort(
        (a, b) =>
          a.departureAt.getTime() - b.departureAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    const airportCodes = [
      ...new Set(
        flights.flatMap((flight) => [
          flight.departureAirportId,
          flight.arrivalAirportId,
        ]),
      ),
    ];
    const airports = await this.referenceData.getAirports(airportCodes);
    const start = (query.page - 1) * query.limit;
    const items = flights
      .slice(start, start + query.limit)
      .map((flight): FlightManagementView => {
        const departureAirport = airports.get(flight.departureAirportId);
        const arrivalAirport = airports.get(flight.arrivalAirportId);
        if (!departureAirport || !arrivalAirport) {
          throw new InternalServerErrorException({
            code: ErrorCode.InternalError,
            message: 'A flight references an unknown airport',
          });
        }
        return {
          ...structuredClone(flight),
          departureTimeZone: departureAirport.timeZone,
          arrivalTimeZone: arrivalAirport.timeZone,
        };
      });
    return toPage(items, flights.length, query.page, query.limit);
  }

  getFlightsForBooking(
    flightIds: string[],
  ): Promise<Map<string, FlightWithAirline>> {
    const result = new Map<string, FlightWithAirline>();
    for (const id of flightIds) {
      const flight = this.data.flight(id);
      const airline = flight && this.data.airline(flight.airlineId);
      if (flight && airline) {
        result.set(id, {
          flight: structuredClone(flight),
          airline: structuredClone(airline),
        });
      }
    }
    return Promise.resolve(result);
  }

  checkBookable(
    flightId: string,
    cabinId: string,
    seats: number,
  ): Promise<BookabilityResult> {
    const flight = this.data.flight(flightId);
    if (!flight) return no('flight_not_found');
    const cabin = flight.cabins.find((c) => c.id === cabinId);
    if (!cabin) return no('cabin_not_found');
    if (!this.data.airline(flight.airlineId)?.isActive) {
      return no('airline_inactive');
    }
    if (flight.status !== 'scheduled') return no('flight_not_scheduled');
    if (flight.departureAt.getTime() <= Date.now())
      return no('departure_passed');
    if (cabin.availableSeats < seats) return no('not_enough_seats');
    return Promise.resolve({ bookable: true });
  }

  search(query: OneWaySearchQuery): Promise<Paginated<FlightSearchItem>>;
  search(query: RoundTripSearchQuery): Promise<RoundTripSearchResult>;
  search(
    query: SearchFlightsQuery,
  ): Promise<Paginated<FlightSearchItem> | RoundTripSearchResult>;
  search(
    query: SearchFlightsQuery,
  ): Promise<Paginated<FlightSearchItem> | RoundTripSearchResult> {
    if (
      query.minPriceMinor !== undefined &&
      query.maxPriceMinor !== undefined &&
      query.minPriceMinor > query.maxPriceMinor
    ) {
      return Promise.reject(
        new BadRequestException({
          code: ErrorCode.ValidationFailed,
          message: 'minPriceMinor must not be greater than maxPriceMinor',
          details: [
            {
              field: 'minPriceMinor',
              message: 'must not be greater than maxPriceMinor',
            },
          ],
        }),
      );
    }
    const outbound = this.searchLeg(query, query.from, query.to, query.date);
    if (query.returnDate === undefined) return Promise.resolve(outbound);
    const inbound = this.searchLeg(
      query,
      query.to,
      query.from,
      query.returnDate,
    );
    return Promise.resolve({ outbound, inbound });
  }

  getAirline(airlineId: string): Promise<AirlineView | null> {
    const airline = this.data.airline(airlineId);
    return Promise.resolve(airline ? structuredClone(airline) : null);
  }

  setAirlineActive(airlineId: string, isActive: boolean): Promise<AirlineView> {
    const airline = this.data.airline(airlineId);
    if (!airline) {
      return Promise.reject(
        new NotFoundException({
          code: ErrorCode.NotFound,
          message: 'Airline not found',
        }),
      );
    }

    airline.isActive = isActive;
    return Promise.resolve(structuredClone(airline));
  }

  private newFlightId(): string {
    let id = `created-flight-${this.nextFlightId++}`;
    while (this.data.flight(id)) id = `created-flight-${this.nextFlightId++}`;
    return id;
  }

  /** One direction of a search: filter, sort, paginate. */
  private searchLeg(
    query: SearchFlightsBase,
    from: string,
    to: string,
    date: string,
  ): Paginated<FlightSearchItem> {
    const seats = query.adults + query.children;
    const now = Date.now();
    const found: FlightSearchItem[] = [];
    for (const flight of this.data.flights()) {
      const airline = this.data.airline(flight.airlineId);
      const bookable =
        airline?.isActive === true &&
        flight.status === 'scheduled' &&
        flight.departureAt.getTime() > now &&
        flight.departureAirportId === from &&
        flight.arrivalAirportId === to &&
        flight.departureLocalDate === date;
      if (!airline || !bookable) continue;
      const matchingCabins = flight.cabins
        .filter((cabin) => matches(cabin, query, seats))
        .sort((a, b) => a.priceMinor - b.priceMinor);
      if (matchingCabins.length > 0) {
        found.push(structuredClone({ flight, airline, matchingCabins }));
      }
    }
    found.sort(compareBy(query.sortBy));
    const start = (query.page - 1) * query.limit;
    return toPage(
      found.slice(start, start + query.limit),
      found.length,
      query.page,
      query.limit,
    );
  }
}

function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'Invalid flight',
    details: [{ field, message }],
  });
}

function no(reason: Extract<BookabilityResult, { bookable: false }>['reason']) {
  return Promise.resolve<BookabilityResult>({ bookable: false, reason });
}

/** Enough seats (infants take none), the requested class, and a price in the inclusive range. */
function matches(cabin: CabinView, query: SearchFlightsBase, seats: number) {
  return (
    cabin.availableSeats >= seats &&
    (query.cabinClass === undefined || cabin.cabinClass === query.cabinClass) &&
    (query.minPriceMinor === undefined ||
      cabin.priceMinor >= query.minPriceMinor) &&
    (query.maxPriceMinor === undefined ||
      cabin.priceMinor <= query.maxPriceMinor)
  );
}

/** Sorts ascending by the chosen key; ties fall back to departure time, then ID, so the order is stable. */
function compareBy(sortBy: SearchFlightsBase['sortBy']) {
  const key = (item: FlightSearchItem): number => {
    if (sortBy === 'price') return item.matchingCabins[0].priceMinor;
    if (sortBy === 'duration') return item.flight.durationMinutes;
    return item.flight.departureAt.getTime();
  };
  return (a: FlightSearchItem, b: FlightSearchItem) =>
    key(a) - key(b) ||
    departure(a.flight) - departure(b.flight) ||
    a.flight.id.localeCompare(b.flight.id);
}

function departure(flight: FlightView): number {
  return flight.departureAt.getTime();
}
