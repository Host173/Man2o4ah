import type { CabinClass } from '../../src/common/database/cabin-class.js';
import type {
  AirlineView,
  BaggagePolicyView,
  CabinView,
  CancellationTierView,
  FlightView,
} from '../../src/modules/flights/flights.types.js';
import type { FlightStatus } from '../../src/modules/flights/schemas/flight.schema.js';

export interface FakeAirlineSeed {
  id: string;
  code: string;
  name?: string;
  isActive?: boolean;
  baggagePolicy?: BaggagePolicyView;
  cancellationTiers?: CancellationTierView[];
}

export interface FakeCabinSeed {
  id: string;
  cabinClass: CabinClass;
  totalSeats: number;
  /** Defaults to `totalSeats - heldSeats - bookedSeats`. */
  availableSeats?: number;
  heldSeats?: number;
  bookedSeats?: number;
  priceMinor: number;
  freeBags?: number;
  maxBagWeightKg?: number;
}

export interface FakeFlightSeed {
  id: string;
  airlineId: string;
  flightNumber: string;
  departureAirportId: string;
  arrivalAirportId: string;
  departureAt: Date;
  arrivalAt: Date;
  /** The fake has no time zones: defaults to the UTC date of `departureAt`. */
  departureLocalDate?: string;
  status?: FlightStatus;
  hasBookings?: boolean;
  cabins: FakeCabinSeed[];
  departureTimeZone?: string;
  arrivalTimeZone?: string;
}

/**
 * The airlines and flights behind `FakeFlightsService` and `FakeSeatInventory`.
 * Give both fakes the same instance and a hold made through one is visible
 * through the other, like the real flights collection. The seeds are checked
 * like the schema checks them, so a test can't start from an impossible state.
 * `airline`, `flight` and `flights` return the live objects: read through the
 * fakes, don't change them from a test.
 */
export class FakeFlightsData {
  private readonly airlineMap = new Map<string, AirlineView>();
  private readonly flightMap = new Map<string, FlightView>();

  addAirline(seed: FakeAirlineSeed): AirlineView {
    if (this.airlineMap.has(seed.id)) {
      throw new Error(`Airline ${seed.id} is already seeded`);
    }
    const airline: AirlineView = {
      id: seed.id,
      code: seed.code,
      name: seed.name ?? `Airline ${seed.code}`,
      isActive: seed.isActive ?? true,
      baggagePolicy: seed.baggagePolicy ?? {
        extraBagPriceMinor: null,
        maxExtraBagsPerPassenger: 0,
      },
      cancellationTiers: seed.cancellationTiers ?? [],
    };
    this.airlineMap.set(airline.id, airline);
    return structuredClone(airline);
  }

  addFlight(seed: FakeFlightSeed): FlightView {
    if (this.flightMap.has(seed.id)) {
      throw new Error(`Flight ${seed.id} is already seeded`);
    }
    if (!this.airlineMap.has(seed.airlineId)) {
      throw new Error(`Seed airline ${seed.airlineId} before its flights`);
    }
    if (seed.departureAirportId === seed.arrivalAirportId) {
      throw new Error('departureAirportId must differ from arrivalAirportId');
    }
    if (seed.arrivalAt.getTime() <= seed.departureAt.getTime()) {
      throw new Error('arrivalAt must be after departureAt');
    }
    if (seed.cabins.length > 4) {
      throw new Error('A flight has at most 4 cabins');
    }
    const classes = new Set(seed.cabins.map((c) => c.cabinClass));
    if (classes.size !== seed.cabins.length) {
      throw new Error('A flight has each cabin class at most once');
    }
    const flight: FlightView = {
      id: seed.id,
      airlineId: seed.airlineId,
      flightNumber: seed.flightNumber,
      departureAirportId: seed.departureAirportId,
      arrivalAirportId: seed.arrivalAirportId,
      departureAt: new Date(seed.departureAt),
      arrivalAt: new Date(seed.arrivalAt),
      departureLocalDate:
        seed.departureLocalDate ?? seed.departureAt.toISOString().slice(0, 10),
      durationMinutes: Math.round(
        (seed.arrivalAt.getTime() - seed.departureAt.getTime()) / 60000,
      ),
      status: seed.status ?? 'scheduled',
      hasBookings: seed.hasBookings ?? false,
      cabins: seed.cabins.map(toCabin),
      departureTimeZone:
        seed.departureTimeZone ??
        (seed.departureAirportId === 'CAI'
          ? 'Africa/Cairo'
          : seed.departureAirportId === 'JFK'
            ? 'America/New_York'
            : 'UTC'),
      arrivalTimeZone:
        seed.arrivalTimeZone ??
        (seed.arrivalAirportId === 'DXB'
          ? 'Asia/Dubai'
          : seed.arrivalAirportId === 'CAI'
            ? 'Africa/Cairo'
            : 'UTC'),
    };
    this.flightMap.set(flight.id, flight);
    return structuredClone(flight);
  }

  airline(id: string): AirlineView | undefined {
    return this.airlineMap.get(id);
  }

  flight(id: string): FlightView | undefined {
    return this.flightMap.get(id);
  }

  flights(): FlightView[] {
    return [...this.flightMap.values()];
  }
}

function toCabin(seed: FakeCabinSeed): CabinView {
  const held = seed.heldSeats ?? 0;
  const booked = seed.bookedSeats ?? 0;
  const available = seed.availableSeats ?? seed.totalSeats - held - booked;
  if (seed.totalSeats !== available + held + booked) {
    throw new Error(
      `Cabin ${seed.id}: totalSeats must equal availableSeats + heldSeats + bookedSeats`,
    );
  }
  return {
    id: seed.id,
    cabinClass: seed.cabinClass,
    totalSeats: seed.totalSeats,
    availableSeats: available,
    heldSeats: held,
    bookedSeats: booked,
    priceMinor: seed.priceMinor,
    freeBags: seed.freeBags ?? 1,
    maxBagWeightKg: seed.maxBagWeightKg ?? 23,
  };
}
