import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import type { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import type { FlightHold, FlightQuote } from './flight-bookings.types.js';
import { FlightQuoteService } from './flight-quote.service.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

/** How long held seats wait for payment (FLT-22). */
const HOLD_MINUTES = 10;

/**
 * The flight seat hold (FLT-22). Validates and prices exactly like the quote,
 * then, in one transaction, holds the seats of every segment and saves the
 * `pending_payment` booking with its snapshots. Both writes succeed or neither
 * does; no seats left → 409 SEATS_UNAVAILABLE (from `SeatInventory.hold`).
 */
@Injectable()
export class FlightHoldService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    private readonly quotes: FlightQuoteService,
    private readonly seatInventory: SeatInventory,
  ) {}

  async hold(
    request: FlightQuoteRequestDto,
    userId: string,
  ): Promise<FlightHold> {
    // The same checks and prices as the quote (FLT-19): one set of rules.
    const quote = await this.quotes.quote(request);

    const createdAt = new Date();
    const holdExpiresAt = new Date(
      createdAt.getTime() + HOLD_MINUTES * 60 * 1000,
    );
    // A hold must not outlive the flight: the whole 10 minutes must fit
    // before the outbound departure (decided on review #147).
    if (quote.segments[0].departureAt < holdExpiresAt) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'The booking request is not valid',
        details: [
          {
            field: 'segments[0]',
            message: `This flight leaves in less than ${HOLD_MINUTES} minutes and can no longer be held`,
          },
        ],
      });
    }

    let bookingId = '';
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // Seats first: if they're gone, nothing else is written.
        await this.seatInventory.hold(
          quote.segments.map((s) => ({
            flightId: s.flightId,
            cabinId: s.cabinId,
            seats: quote.seatCount,
          })),
          { session },
        );
        const [booking] = await this.bookingModel.create(
          [toBookingDocument(quote, userId, createdAt, holdExpiresAt)],
          { session },
        );
        bookingId = booking._id.toString();
      });
    } finally {
      await session.endSession();
    }

    return {
      ...quote,
      bookingId,
      status: FlightBookingStatus.PENDING_PAYMENT,
      holdExpiresAt,
    };
  }
}

/** The booking to save: the quote's snapshots, owned by `userId`, waiting for payment. */
function toBookingDocument(
  quote: FlightQuote,
  userId: string,
  createdAt: Date,
  holdExpiresAt: Date,
) {
  const segments = quote.segments;
  return {
    userId,
    status: FlightBookingStatus.PENDING_PAYMENT,
    tripType: quote.tripType,
    segments: segments.map((s) => ({
      direction: s.direction,
      flightId: s.flightId,
      cabinId: s.cabinId,
      cabinClass: s.cabinClass,
      airlineId: s.airlineId,
      flightNumber: s.flightNumber,
      departureAirportId: s.departureAirportId,
      arrivalAirportId: s.arrivalAirportId,
      departureAt: s.departureAt,
      arrivalAt: s.arrivalAt,
      fareMinor: s.fareMinor,
      policy: s.policy,
    })),
    passengers: quote.passengers.map((p) => ({
      type: p.type,
      fullName: p.fullName,
      dateOfBirth: toDateOnly(p.dateOfBirth),
      documentNumber: p.documentNumber,
      extraBagCount: p.extraBagCount,
      extraBagWeightKg: p.extraBagWeightKg,
    })),
    seatCount: quote.seatCount,
    pricing: quote.pricing,
    holdExpiresAt,
    firstDepartureAt: segments[0].departureAt,
    lastDepartureAt: segments[segments.length - 1].departureAt,
    // Set explicitly so holdExpiresAt is exactly createdAt + 10 minutes.
    createdAt,
  };
}
