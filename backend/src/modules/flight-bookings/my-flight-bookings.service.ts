import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { paginate } from '../../common/pagination/paginate.js';
import { toPage } from '../../common/pagination/paginated.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { BookingType } from '../../common/database/booking-type.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { RefundView } from '../payments/payments.types.js';
import { groupQuery } from './booking-groups.js';
import type { BookingGroup } from './booking-groups.js';
import type {
  MyFlightBooking,
  MyFlightBookingSummary,
} from './flight-bookings.types.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

/** A booking as `.lean()` returns it: the schema fields plus `_id`. */
type LeanBooking = FlightBooking & { _id: Types.ObjectId };
/** With `timestamps: true` Mongoose also saves `createdAt`. */
type LeanBookingWithTimestamps = LeanBooking & { createdAt: Date };

/** Only what a list row shows; document numbers and policies stay in the database. */
const SUMMARY_FIELDS = {
  reference: 1,
  status: 1,
  tripType: 1,
  firstDepartureAt: 1,
  seatCount: 1,
  'pricing.totalMinor': 1,
  'pricing.currency': 1,
  'passengers.type': 1,
  'passengers.fullName': 1,
  'segments.direction': 1,
  'segments.flightNumber': 1,
  'segments.departureAirportId': 1,
  'segments.arrivalAirportId': 1,
  'segments.departureAt': 1,
  'segments.arrivalAt': 1,
  'segments.cabinClass': 1,
} as const;

/** FLT-25: a user's own flight bookings, read-only. */
@Injectable()
export class MyFlightBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly payments: PaymentsService,
  ) {}

  /** One group (upcoming, past or cancelled) of the user's bookings, one page at a time. */
  async listMine(
    userId: string,
    group: BookingGroup,
    paging: { page: number; limit: number },
    now: Date = new Date(),
  ): Promise<Paginated<MyFlightBookingSummary>> {
    const { filter, sort } = groupQuery(group, now);
    const page = await paginate(
      this.bookings,
      { ...filter, userId: new Types.ObjectId(userId) },
      paging,
      { sort, projection: SUMMARY_FIELDS },
    );
    const items = page.items.map(toSummary);
    return toPage(items, page.total, page.page, page.limit);
  }

  /**
   * The full booking, in any status, if it belongs to the user. Anyone else's,
   * an unknown id or a malformed id all answer 404, so ids can't be probed (ACC-11).
   */
  async getMine(bookingId: string, userId: string): Promise<MyFlightBooking> {
    if (!Types.ObjectId.isValid(bookingId)) throw notFound();
    const booking = await this.bookings
      .findOne({ _id: bookingId, userId: new Types.ObjectId(userId) })
      .lean<LeanBookingWithTimestamps>();
    if (!booking) throw notFound();
    const refund = await this.payments.getRefund(
      BookingType.FLIGHT,
      booking._id.toHexString(),
    );
    return toDetails(booking, refund);
  }
}

function toSummary(b: LeanBooking): MyFlightBookingSummary {
  return {
    _id: b._id.toHexString(),
    reference: b.reference,
    status: b.status,
    tripType: b.tripType,
    firstDepartureAt: b.firstDepartureAt,
    segments: b.segments.map((s) => ({
      direction: s.direction,
      flightNumber: s.flightNumber,
      departureAirportId: s.departureAirportId,
      arrivalAirportId: s.arrivalAirportId,
      departureAt: s.departureAt,
      arrivalAt: s.arrivalAt,
      cabinClass: s.cabinClass,
    })),
    passengers: b.passengers.map((p) => ({
      type: p.type,
      fullName: p.fullName,
    })),
    seatCount: b.seatCount,
    pricing: {
      totalMinor: b.pricing.totalMinor,
      currency: b.pricing.currency,
    },
  };
}

function toDetails(
  b: LeanBookingWithTimestamps,
  refund: RefundView | null,
): MyFlightBooking {
  return {
    _id: b._id.toHexString(),
    reference: b.reference,
    status: b.status,
    tripType: b.tripType,
    segments: b.segments.map((s) => ({
      direction: s.direction,
      flightId: s.flightId.toHexString(),
      cabinClass: s.cabinClass,
      airlineId: s.airlineId.toHexString(),
      flightNumber: s.flightNumber,
      departureAirportId: s.departureAirportId,
      arrivalAirportId: s.arrivalAirportId,
      departureAt: s.departureAt,
      arrivalAt: s.arrivalAt,
      fareMinor: s.fareMinor,
      policy: {
        cancellationTiers: s.policy.cancellationTiers.map((t) => ({
          daysBefore: t.daysBefore,
          refundPercent: t.refundPercent,
        })),
        freeBags: s.policy.freeBags,
        maxBagWeightKg: s.policy.maxBagWeightKg,
        extraBagPriceMinor: s.policy.extraBagPriceMinor,
        maxExtraBagsPerPassenger: s.policy.maxExtraBagsPerPassenger,
      },
    })),
    passengers: b.passengers.map((p) => ({
      type: p.type,
      fullName: p.fullName,
      // A DateOnly is stored at 00:00 UTC, so its ISO date part is the calendar date.
      dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
      documentNumber: p.documentNumber,
      extraBagCount: p.extraBagCount,
      extraBagWeightKg: p.extraBagWeightKg,
    })),
    seatCount: b.seatCount,
    pricing: {
      fareTotalMinor: b.pricing.fareTotalMinor,
      baggageTotalMinor: b.pricing.baggageTotalMinor,
      totalMinor: b.pricing.totalMinor,
      currency: b.pricing.currency,
    },
    holdExpiresAt: b.holdExpiresAt,
    confirmedAt: b.confirmedAt,
    expiredAt: b.expiredAt,
    completedAt: b.completedAt,
    cancellation: b.cancellation && {
      cancelledAt: b.cancellation.cancelledAt,
      cancelledBy: b.cancellation.cancelledBy,
      refundPercent: b.cancellation.refundPercent,
      refundAmountMinor: b.cancellation.refundAmountMinor,
    },
    refund,
    createdAt: b.createdAt,
  };
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'Flight booking not found',
  });
}
