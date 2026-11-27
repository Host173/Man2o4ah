import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { BookingType } from '../../common/database/booking-type.js';
import type { ErrorDetail } from '../../common/errors/error-body.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { MAX_BOOKING_TOTAL_MINOR } from '../../common/money/money.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import type {
  FlightChangeQueryDto,
  FlightChangeRequestDto,
} from './dto/flight-change.dto.js';
import type {
  ChangedFlightBooking,
  FlightChangePreview,
  QuotedSegment,
} from './flight-bookings.types.js';
import { quoteFlightChange } from './flight-change.js';
import { assertChangeable, checkNewFlight } from './flight-change-rules.js';
import type { ChangeableSegment } from './flight-change-rules.js';
import { FlightQuoteService, HOLD_MINUTES } from './flight-quote.service.js';
import {
  FlightBooking,
  FlightBookingStatus,
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

/** The snapshot to save for the new flight: the quoted segment without its display-only airline name. */
function toSegmentDocument(s: QuotedSegment) {
  return {
    direction: s.direction,
    flightId: new Types.ObjectId(s.flightId),
    cabinId: new Types.ObjectId(s.cabinId),
    cabinClass: s.cabinClass,
    airlineId: new Types.ObjectId(s.airlineId),
    flightNumber: s.flightNumber,
    departureAirportId: s.departureAirportId,
    arrivalAirportId: s.arrivalAirportId,
    departureAt: s.departureAt,
    arrivalAt: s.arrivalAt,
    fareMinor: s.fareMinor,
    policy: s.policy,
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
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly flights: FlightsService,
    private readonly quotes: FlightQuoteService,
    private readonly seatInventory: SeatInventory,
    private readonly payments: PaymentsService,
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
    return this.price(await this.findOwned(id, userId), query, now);
  }

  /**
   * Requests a change (FLT-27), checked and priced exactly as `preview` does.
   * Everything happens in one transaction:
   * - Same or lower fare: applied now. The booking is updated in place (new
   *   segment snapshot, pricing, departure dates, the change appended to
   *   `changes`) and the seats move: held then booked on the new flight,
   *   returned on the old one. After the commit a lower fare is refunded in
   *   full (PAY-03).
   * - Higher fare: the change is stored as `pendingChange` and the new seats
   *   are held for HOLD_MINUTES, like a seat hold. Nothing else changes until
   *   the difference is paid; `FlightChangeExpiryJob` drops it if unpaid.
   * The update only matches the booking as it was priced (same segment `_id`
   * and total, no pending change), so of two parallel changes exactly one wins
   * and the other answers 409, even when the transaction is retried.
   */
  async change(
    id: string,
    userId: string,
    request: FlightChangeRequestDto,
    now: Date = new Date(),
  ): Promise<ChangedFlightBooking> {
    const booking = await this.findOwned(id, userId);
    const priced = await this.price(booking, request, now);
    const needsPayment = priced.differenceMinor > 0;
    const holdExpiresAt = needsPayment
      ? new Date(now.getTime() + HOLD_MINUTES * 60_000)
      : null;

    const index = booking.segments.findIndex(
      (s) => s.direction === request.direction,
    );
    const old = booking.segments[index] as FlightSegment & {
      _id: Types.ObjectId;
    };
    const newSegment = toSegmentDocument(priced.segment);
    const segmentsAfter = booking.segments.map((s, i) =>
      i === index ? newSegment : s,
    );
    const changeId = new Types.ObjectId();
    const seats = booking.seatCount;

    const update = needsPayment
      ? {
          $set: {
            pendingChange: {
              _id: changeId,
              direction: request.direction,
              segment: newSegment,
              pricing: priced.pricing,
              differenceMinor: priced.differenceMinor,
              holdExpiresAt,
              requestedAt: now,
            },
          },
        }
      : {
          $set: {
            [`segments.${index}`]: newSegment,
            pricing: priced.pricing,
            firstDepartureAt: segmentsAfter[0].departureAt,
            lastDepartureAt:
              segmentsAfter[segmentsAfter.length - 1].departureAt,
          },
          $push: {
            changes: {
              _id: changeId,
              direction: request.direction,
              previousSegment: old,
              newFlightId: newSegment.flightId,
              previousTotalMinor: booking.pricing.totalMinor,
              newTotalMinor: priced.pricing.totalMinor,
              differenceMinor: priced.differenceMinor,
              changedAt: now,
            },
          },
        };

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const result = await this.bookings.updateOne(
          {
            _id: booking._id,
            status: FlightBookingStatus.CONFIRMED,
            pendingChange: { $exists: false },
            [`segments.${index}._id`]: old._id,
            'pricing.totalMinor': booking.pricing.totalMinor,
          },
          update,
          { session, runValidators: true },
        );
        if (result.modifiedCount !== 1) {
          throw new ConflictException({
            code: ErrorCode.ConcurrentChange,
            message: 'The booking changed meanwhile; preview the change again',
          });
        }
        const newSeats = {
          flightId: priced.segment.flightId,
          cabinId: priced.segment.cabinId,
          seats,
        };
        // SEATS_UNAVAILABLE here rolls the booking update back too.
        await this.seatInventory.hold([newSeats], { session });
        // A paid change keeps the new seats held until payment, and the old
        // ones booked: the user flies the old flight until then.
        if (needsPayment) return;
        await this.seatInventory.confirm([newSeats], { session });
        await this.seatInventory.returnBooked(
          [
            {
              flightId: old.flightId.toString(),
              cabinId: old.cabinId.toString(),
              seats,
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    // The same known gap as FLT-26: if this call fails for a reason other than
    // Stripe (which PAY-03 records as `failed`), the change stays applied
    // without a refund record, and the error propagates.
    const refund =
      priced.differenceMinor < 0
        ? await this.payments.refund({
            bookingType: BookingType.FLIGHT,
            bookingId: booking._id.toHexString(),
            userId,
            amountMinor: -priced.differenceMinor,
            currency: priced.pricing.currency,
            reason: 'booking_change',
            changeId: changeId.toHexString(),
          })
        : null;

    return {
      ...priced,
      bookingId: booking._id.toHexString(),
      reference: booking.reference ?? '',
      status: FlightBookingStatus.CONFIRMED,
      applied: !needsPayment,
      holdExpiresAt,
      changeId: changeId.toHexString(),
      refund,
    };
  }

  /** Checks and prices a change of `booking` (see `preview`); reads but writes nothing. */
  private async price(
    booking: FlightBooking,
    query: FlightChangeQueryDto,
    now: Date,
  ): Promise<FlightChangePreview> {
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
  private async findOwned(id: string, userId: string) {
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
