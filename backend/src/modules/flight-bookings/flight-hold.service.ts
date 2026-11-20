import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import type { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import type { FlightHold, FlightQuote } from './flight-bookings.types.js';
import { FlightHoldExpiryJob } from './flight-hold-expiry.job.js';
import { FlightQuoteService, HOLD_MINUTES } from './flight-quote.service.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

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
    private readonly expiry: FlightHoldExpiryJob,
  ) {}

  async hold(
    request: FlightQuoteRequestDto,
    userId: string,
  ): Promise<FlightHold> {
    // One clock reading for everything: the quote checks "the flight leaves at
    // least HOLD_MINUTES from now" against the same moment the hold starts, so
    // the hold can't end after departure (review #147).
    const createdAt = new Date();
    // backend.md §10: never assume the expiry job already ran. Free the
    // overdue holds on these flights first, before the quote's seat check,
    // so their seats count as free.
    await this.expiry.expireDueHolds(createdAt, {
      'segments.flightId': { $in: request.segments.map((s) => s.flightId) },
    });
    // The same checks and prices as the quote (FLT-19): one set of rules.
    const quote = await this.quotes.quote(request, createdAt);

    const holdExpiresAt = new Date(
      createdAt.getTime() + HOLD_MINUTES * 60 * 1000,
    );

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
