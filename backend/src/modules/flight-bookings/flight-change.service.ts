import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { ErrorDetail } from '../../common/errors/error-body.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { MAX_BOOKING_TOTAL_MINOR } from '../../common/money/money.js';
import { FlightsService } from '../flights/flights.service.js';
import type { FlightChangeQueryDto } from './dto/flight-change.dto.js';
import type { FlightChangePreview } from './flight-bookings.types.js';
import { quoteFlightChange } from './flight-change.js';
import { assertChangeable, checkNewFlight } from './flight-change-rules.js';
import type { ChangeableSegment } from './flight-change-rules.js';
import { FlightQuoteService } from './flight-quote.service.js';
import {
  FlightBooking,
  FlightSegment,
} from './schemas/flight-booking.schema.js';

function invalid(details: ErrorDetail[]): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'The change request is not valid',
    details,
  });
}

/** What the change rules need from a saved segment. */
function toChangeable(segment: FlightSegment): ChangeableSegment {
  return {
    direction: segment.direction,
    flightId: segment.flightId.toString(),
    departureAirportId: segment.departureAirportId,
    arrivalAirportId: segment.arrivalAirportId,
    cabinClass: segment.cabinClass,
    departureAt: segment.departureAt,
    arrivalAt: segment.arrivalAt,
  };
}

/**
 * The quote reports problems with its one segment as `segments[0]…`; for a
 * change that segment is the requested `flightId`.
 */
function renameQuoteErrors(error: unknown): unknown {
  if (!(error instanceof BadRequestException)) return error;
  const body = error.getResponse() as { details?: ErrorDetail[] };
  if (!body.details) return error;
  return invalid(
    body.details.map((d) =>
      d.field.startsWith('segments[0]') ? { ...d, field: 'flightId' } : d,
    ),
  );
}

/**
 * FLT-27: the owner changes one direction of a confirmed booking to another
 * flight on the same route, in the same cabin class.
 */
@Injectable()
export class FlightChangeService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly flights: FlightsService,
    private readonly quotes: FlightQuoteService,
  ) {}

  /**
   * Read-only: what the change would cost now. The new flight is checked the
   * way a hold checks it, by quoting it alone for the booking's passengers
   * (flight and airline bookable, seats for everyone, the 10-minute rule, bag
   * limits, ages). The price difference uses the booking's snapshot fares for
   * the segment that stays. Known limit: for a return change, ages are checked
   * on the return date, not the outbound date.
   */
  async preview(
    id: string,
    userId: string,
    query: FlightChangeQueryDto,
    now: Date = new Date(),
  ): Promise<FlightChangePreview> {
    const booking = await this.findOwned(id, userId);
    const segments = booking.segments.map(toChangeable);
    assertChangeable(
      {
        status: booking.status,
        hasPendingChange: booking.pendingChange != null,
        segments,
      },
      query.direction,
      now,
    );

    const entry = (
      await this.flights.getFlightsForBooking([query.flightId])
    ).get(query.flightId);
    if (!entry) {
      throw invalid([
        { field: 'flightId', message: 'This flight does not exist' },
      ]);
    }
    const { flight } = entry;
    const problems = checkNewFlight(
      segments,
      query.direction,
      {
        flightId: flight.id,
        status: flight.status,
        departureAirportId: flight.departureAirportId,
        arrivalAirportId: flight.arrivalAirportId,
        cabinClasses: flight.cabins.map((c) => c.cabinClass),
        departureAt: flight.departureAt,
        arrivalAt: flight.arrivalAt,
      },
      now,
    );
    if (problems.length > 0) throw invalid(problems);

    // checkNewFlight has made sure the flight has a cabin of the booked class.
    const current = segments.find((s) => s.direction === query.direction)!;
    const cabin = flight.cabins.find(
      (c) => c.cabinClass === current.cabinClass,
    )!;

    let quoted;
    try {
      quoted = await this.quotes.quote(
        {
          tripType: 'one_way',
          segments: [{ flightId: flight.id, cabinId: cabin.id }],
          passengers: booking.passengers.map((p) => ({
            type: p.type,
            fullName: p.fullName,
            dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
            documentNumber: p.documentNumber,
            extraBagCount: p.extraBagCount,
            extraBagWeightKg: p.extraBagWeightKg,
          })),
        },
        now,
      );
    } catch (error) {
      throw renameQuoteErrors(error);
    }
    const segment = { ...quoted.segments[0], direction: query.direction };

    const change = quoteFlightChange(
      booking.segments.map((s) => ({
        direction: s.direction,
        airlineId: s.airlineId.toString(),
        fareMinor: s.fareMinor,
        extraBagPriceMinor: s.policy.extraBagPriceMinor,
      })),
      booking.passengers,
      booking.pricing.totalMinor,
      {
        direction: query.direction,
        airlineId: segment.airlineId,
        fareMinor: segment.fareMinor,
        extraBagPriceMinor: segment.policy.extraBagPriceMinor,
      },
    );
    if (change.newPrice.totalMinor > MAX_BOOKING_TOTAL_MINOR) {
      throw invalid([
        {
          field: 'flightId',
          message: `The new total is more than ${MAX_BOOKING_TOTAL_MINOR} minor units, the most one booking can be`,
        },
      ]);
    }

    return {
      direction: query.direction,
      segment,
      pricing: {
        fareTotalMinor: change.newPrice.fareTotalMinor,
        baggageTotalMinor: change.newPrice.baggageTotalMinor,
        totalMinor: change.newPrice.totalMinor,
        currency: booking.pricing.currency,
      },
      differenceMinor: change.differenceMinor,
    };
  }

  /** The user's own booking; someone else's and an unknown id look the same (ACC-11). */
  private async findOwned(id: string, userId: string): Promise<FlightBooking> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      throw this.notFound();
    }
    const booking = await this.bookings.findOne({ _id: id, userId }).lean();
    if (!booking) throw this.notFound();
    return booking;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Flight booking not found',
    });
  }
}
