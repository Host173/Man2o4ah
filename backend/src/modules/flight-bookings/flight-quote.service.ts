import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { toDateOnly } from '../../common/dates/date-only.js';
import type { ErrorDetail } from '../../common/errors/error-body.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { getPlatformCurrency } from '../../common/money/platform-currency.js';
import { FlightsService } from '../flights/flights.service.js';
import type {
  AirlineView,
  BookabilityProblem,
  CabinView,
  FlightView,
} from '../flights/flights.types.js';
import type { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import type { FlightQuote, QuotedSegment } from './flight-bookings.types.js';
import { priceFlightBooking } from './flight-pricing.js';
import { checkPassengers } from './passenger-rules.js';
import type { RulePassenger } from './passenger-rules.js';

/** One requested segment once its flight, airline and cabin are loaded. */
interface Leg {
  flight: FlightView;
  airline: AirlineView;
  cabin: CabinView;
}

/** What the user sees when a segment can't be booked (seat shortage is a 409 instead). */
const NOT_BOOKABLE: Record<
  Exclude<BookabilityProblem, 'not_enough_seats'>,
  string
> = {
  flight_not_found: 'This flight does not exist',
  cabin_not_found: 'This cabin does not exist on the flight',
  airline_inactive: 'This airline is not taking bookings',
  flight_not_scheduled: 'This flight is no longer scheduled',
  departure_passed: 'This flight has already departed',
};

/**
 * How long a hold keeps seats for payment (FLT-22). A flight that leaves
 * sooner can't be quoted or held: a hold must not outlive the flight
 * (decided on review #147).
 */
export const HOLD_MINUTES = 10;

function invalid(details: ErrorDetail[]): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'The booking request is not valid',
    details,
  });
}

/** An airline that sells no extra bags allows none, whatever its maximum says. */
function maxExtraBags(airline: AirlineView): number {
  const { extraBagPriceMinor, maxExtraBagsPerPassenger } =
    airline.baggagePolicy;
  return extraBagPriceMinor === null ? 0 : maxExtraBagsPerPassenger;
}

/**
 * The flight booking quote (FLT-19, FLT-21): validates the trip and the
 * passengers against the flights' current data, prices it on the server and
 * returns the summary. Saves nothing. FLT-22's hold repeats this before reserving.
 */
@Injectable()
export class FlightQuoteService {
  constructor(private readonly flights: FlightsService) {}

  async quote(request: FlightQuoteRequestDto): Promise<FlightQuote> {
    const legs = await this.loadLegs(request);
    const errors = [
      ...this.checkDepartureTime(legs),
      ...this.checkRoute(legs),
      ...this.checkPassengerDetails(request, legs),
    ];

    const seatCount = request.passengers.filter(
      (p) => p.type !== 'infant',
    ).length;
    const results = await Promise.all(
      request.segments.map((s) =>
        this.flights.checkBookable(s.flightId, s.cabinId, seatCount),
      ),
    );
    let seatsShort = false;
    results.forEach((result, i) => {
      if (result.bookable) return;
      if (result.reason === 'not_enough_seats') {
        seatsShort = true;
      } else {
        errors.push({
          field: `segments[${i}]`,
          message: NOT_BOOKABLE[result.reason],
        });
      }
    });

    if (errors.length > 0) throw invalid(errors);
    if (seatsShort) {
      throw new ConflictException({
        code: ErrorCode.SeatsUnavailable,
        message: 'Not enough seats left in the selected cabin',
      });
    }

    const price = priceFlightBooking(
      legs.map(({ airline, cabin }) => ({
        fareMinor: cabin.priceMinor,
        extraBagPriceMinor: airline.baggagePolicy.extraBagPriceMinor ?? 0,
      })),
      request.passengers,
    );

    return {
      tripType: request.tripType,
      seatCount: price.seatCount,
      segments: legs.map((leg, i) => toQuotedSegment(leg, i)),
      passengers: request.passengers.map((p) => ({
        type: p.type,
        fullName: p.fullName,
        dateOfBirth: p.dateOfBirth,
        documentNumber: p.documentNumber,
        extraBagCount: p.extraBagCount,
        extraBagWeightKg: p.extraBagWeightKg,
      })),
      pricing: {
        fareTotalMinor: price.fareTotalMinor,
        baggageTotalMinor: price.baggageTotalMinor,
        totalMinor: price.totalMinor,
        currency: getPlatformCurrency(),
      },
    };
  }

  /** The right number of segments, each with an existing flight and cabin; else 400. */
  private async loadLegs(request: FlightQuoteRequestDto): Promise<Leg[]> {
    const expected = request.tripType === 'round_trip' ? 2 : 1;
    if (request.segments.length !== expected) {
      throw invalid([
        {
          field: 'segments',
          message: `A ${request.tripType} trip needs ${expected} segment(s)`,
        },
      ]);
    }

    const found = await this.flights.getFlightsForBooking(
      request.segments.map((s) => s.flightId),
    );
    const errors: ErrorDetail[] = [];
    const legs: Leg[] = [];
    request.segments.forEach((segment, i) => {
      const entry = found.get(segment.flightId);
      if (!entry) {
        errors.push({
          field: `segments[${i}].flightId`,
          message: NOT_BOOKABLE.flight_not_found,
        });
        return;
      }
      const cabin = entry.flight.cabins.find((c) => c.id === segment.cabinId);
      if (!cabin) {
        errors.push({
          field: `segments[${i}].cabinId`,
          message: NOT_BOOKABLE.cabin_not_found,
        });
        return;
      }
      legs.push({ ...entry, cabin });
    });
    // Nothing else can be checked without the flights.
    if (errors.length > 0) throw invalid(errors);
    return legs;
  }

  /** The outbound must leave at least HOLD_MINUTES from now, so a hold fits before it. */
  private checkDepartureTime(legs: Leg[]): ErrorDetail[] {
    const latestHoldEnd = Date.now() + HOLD_MINUTES * 60 * 1000;
    if (legs[0].flight.departureAt.getTime() >= latestHoldEnd) return [];
    return [
      {
        field: 'segments[0]',
        message: `This flight leaves in less than ${HOLD_MINUTES} minutes and can no longer be booked`,
      },
    ];
  }

  /** A return flies back from the outbound's arrival to its origin, after it lands. */
  private checkRoute(legs: Leg[]): ErrorDetail[] {
    if (legs.length < 2) return [];
    const [outbound, back] = [legs[0].flight, legs[1].flight];
    if (
      back.departureAirportId !== outbound.arrivalAirportId ||
      back.arrivalAirportId !== outbound.departureAirportId
    ) {
      return [
        {
          field: 'segments[1]',
          message: `The return must fly from ${outbound.arrivalAirportId} back to ${outbound.departureAirportId}`,
        },
      ];
    }
    if (back.departureAt <= outbound.arrivalAt) {
      return [
        {
          field: 'segments[1]',
          message: 'The return must leave after the outbound flight lands',
        },
      ];
    }
    return [];
  }

  /**
   * Real calendar dates, then the passenger rules. Ages use the outbound's local
   * departure date: the date on the ticket.
   */
  private checkPassengerDetails(
    request: FlightQuoteRequestDto,
    legs: Leg[],
  ): ErrorDetail[] {
    const errors: ErrorDetail[] = [];
    // Every passenger goes to checkPassengers (it reports by position). An
    // impossible date becomes `undefined`, so the other rules are still checked.
    const passengers: RulePassenger[] = request.passengers.map((p, i) => {
      let dateOfBirth: Date | undefined;
      try {
        dateOfBirth = toDateOnly(p.dateOfBirth);
      } catch {
        errors.push({
          field: `passengers[${i}].dateOfBirth`,
          message: 'This date does not exist',
        });
      }
      return {
        type: p.type,
        dateOfBirth,
        extraBagCount: p.extraBagCount,
        extraBagWeightKg: p.extraBagWeightKg,
      };
    });

    const today = toDateOnly(new Date().toISOString().slice(0, 10));
    return [
      ...errors,
      ...checkPassengers(
        passengers,
        legs.map(({ airline, cabin }) => ({
          maxExtraBagsPerPassenger: maxExtraBags(airline),
          maxBagWeightKg: cabin.maxBagWeightKg,
        })),
        toDateOnly(legs[0].flight.departureLocalDate),
        today,
      ),
    ];
  }
}

/** The segment summary and the snapshot FLT-22 will save. */
function toQuotedSegment(
  { flight, airline, cabin }: Leg,
  index: number,
): QuotedSegment {
  return {
    direction: index === 0 ? 'outbound' : 'return',
    flightId: flight.id,
    cabinId: cabin.id,
    cabinClass: cabin.cabinClass,
    airlineId: airline.id,
    airlineName: airline.name,
    flightNumber: flight.flightNumber,
    departureAirportId: flight.departureAirportId,
    arrivalAirportId: flight.arrivalAirportId,
    departureAt: flight.departureAt,
    arrivalAt: flight.arrivalAt,
    fareMinor: cabin.priceMinor,
    policy: {
      cancellationTiers: airline.cancellationTiers.map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      })),
      freeBags: cabin.freeBags,
      maxBagWeightKg: cabin.maxBagWeightKg,
      extraBagPriceMinor: airline.baggagePolicy.extraBagPriceMinor ?? 0,
      maxExtraBagsPerPassenger: maxExtraBags(airline),
    },
  };
}
