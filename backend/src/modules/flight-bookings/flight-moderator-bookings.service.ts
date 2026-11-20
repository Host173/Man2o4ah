import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model, QueryFilter, SortOrder } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { toPage } from '../../common/pagination/paginated.js';
import type { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { FlightsService } from '../flights/flights.service.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';
import type {
  FlightModeratorBookingView,
  FlightModeratorBookingsPage,
} from './flight-bookings.types.js';
import { flightPassengersCsv } from './flight-passengers-csv.js';
import type { FlightPassengerCsvRow } from './flight-passengers-csv.js';

interface LeanModeratorBooking {
  _id: Types.ObjectId;
  reference?: string;
  status: FlightBookingStatus;
  seatCount: number;
  passengers: { fullName: string }[];
  segments: {
    flightId: Types.ObjectId;
    cabinClass: FlightModeratorBookingView['cabinClass'];
  }[];
}

const BOOKING_STATUSES = [
  FlightBookingStatus.CONFIRMED,
  FlightBookingStatus.CANCELLED,
];

const BOOKING_PROJECTION = {
  reference: 1,
  status: 1,
  seatCount: 1,
  'passengers.fullName': 1,
  'segments.flightId': 1,
  'segments.cabinClass': 1,
};

const BOOKING_SORT: Record<string, SortOrder> = { createdAt: -1, _id: -1 };

@Injectable()
export class FlightModeratorBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly flights: FlightsService,
  ) {}

  /** FLT-29: list confirmed and cancelled bookings with live cabin counters. */
  async listForFlight(
    flightId: string,
    query: PaginationQueryDto,
    moderatorAirlineId: string | undefined,
  ): Promise<FlightModeratorBookingsPage> {
    const flight = await this.ownedFlight(flightId, moderatorAirlineId);
    const filter = this.bookingFilter(flightId);
    const [bookings, total] = await Promise.all([
      this.bookings
        .find(filter, BOOKING_PROJECTION)
        .sort(BOOKING_SORT)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<LeanModeratorBooking[]>()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);

    return {
      ...toPage(
        bookings.map((booking) => this.toView(booking, flightId)),
        total,
        query.page,
        query.limit,
      ),
      seatsRemainingPerCabin: flight.cabins.map((cabin) => ({
        cabinClass: cabin.cabinClass,
        availableSeats: cabin.availableSeats,
      })),
    };
  }

  /** FLT-29: export one CSV row per passenger on the moderator's flight. */
  async exportPassengers(
    flightId: string,
    moderatorAirlineId: string | undefined,
  ): Promise<string> {
    await this.ownedFlight(flightId, moderatorAirlineId);
    const bookings = await this.bookings
      .find(this.bookingFilter(flightId), BOOKING_PROJECTION)
      .sort(BOOKING_SORT)
      .lean<LeanModeratorBooking[]>()
      .exec();
    const rows: FlightPassengerCsvRow[] = bookings.flatMap((booking) => {
      const view = this.toView(booking, flightId);
      return view.passengerNames.map((passengerName) => ({
        reference: view.reference,
        passengerName,
        cabinClass: view.cabinClass,
        seatCount: view.seatCount,
        status: view.status,
      }));
    });
    return flightPassengersCsv(rows);
  }

  private async ownedFlight(
    flightId: string,
    moderatorAirlineId: string | undefined,
  ) {
    if (
      !Types.ObjectId.isValid(flightId) ||
      !moderatorAirlineId ||
      !Types.ObjectId.isValid(moderatorAirlineId)
    ) {
      throw notFound();
    }

    const { flight } = await this.flights.getFlightDetails(flightId);
    if (
      !new Types.ObjectId(flight.airlineId).equals(
        new Types.ObjectId(moderatorAirlineId),
      )
    ) {
      throw notFound();
    }
    return flight;
  }

  private bookingFilter(flightId: string): QueryFilter<FlightBooking> {
    return {
      status: { $in: BOOKING_STATUSES },
      segments: {
        $elemMatch: { flightId: new Types.ObjectId(flightId) },
      },
    };
  }

  private toView(
    booking: LeanModeratorBooking,
    flightId: string,
  ): FlightModeratorBookingView {
    const segment = booking.segments.find((candidate) =>
      candidate.flightId.equals(new Types.ObjectId(flightId)),
    );
    if (!segment || !booking.reference) {
      throw new InternalServerErrorException({
        code: ErrorCode.InternalError,
        message: 'A flight booking is missing its flight or reference',
      });
    }
    return {
      reference: booking.reference,
      passengerNames: booking.passengers.map((passenger) => passenger.fullName),
      cabinClass: segment.cabinClass,
      seatCount: booking.seatCount,
      status: booking.status,
    };
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'Flight not found',
  });
}
