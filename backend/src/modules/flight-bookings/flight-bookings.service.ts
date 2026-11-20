import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter, Types } from 'mongoose';
import { paginate } from '../../common/pagination/paginate.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  AdminFlightBookingQuery,
  FlightBookingAdminView,
} from './flight-bookings.types.js';
import {
  FlightBooking,
  type FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

/** The fields `.lean()` returns for an admin row: no passenger or policy snapshots. */
interface LeanAdminBooking {
  _id: Types.ObjectId;
  reference?: string;
  userId: Types.ObjectId;
  status: FlightBookingStatus;
  firstDepartureAt: Date;
  lastDepartureAt: Date;
  pricing: { totalMinor: number; currency: string };
  /** Outbound first; its airline is the provider shown to admins (ACC-17). */
  segments: { airlineId: Types.ObjectId }[];
  createdAt: Date;
}

/** Only the fields the read-only admin list shows; nothing client-supplied is echoed back. */
const ADMIN_PROJECTION = {
  reference: 1,
  userId: 1,
  status: 1,
  firstDepartureAt: 1,
  lastDepartureAt: 1,
  'pricing.totalMinor': 1,
  'pricing.currency': 1,
  'segments.airlineId': 1,
  createdAt: 1,
} as const;

/** Newest first, with `_id` as a deterministic tie-break (same as other booking lists). */
const ADMIN_SORT = { createdAt: -1, _id: -1 } as const;

@Injectable()
export class FlightBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
  ) {}

  /** ACC-17: every flight booking for the admin list, newest `createdAt` first. Read-only. */
  async listForAdmin(
    query: AdminFlightBookingQuery,
  ): Promise<Paginated<FlightBookingAdminView>> {
    const filter: QueryFilter<FlightBooking> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.from !== undefined || query.to !== undefined) {
      filter.createdAt = {
        ...(query.from !== undefined ? { $gte: query.from } : {}),
        ...(query.to !== undefined ? { $lte: query.to } : {}),
      };
    }

    const page = await paginate(this.bookings, filter, query, {
      sort: ADMIN_SORT,
      projection: ADMIN_PROJECTION,
    });
    return {
      ...page,
      items: page.items.map((item) =>
        toAdminView(item as unknown as LeanAdminBooking),
      ),
    };
  }
}

function toAdminView(b: LeanAdminBooking): FlightBookingAdminView {
  return {
    bookingType: 'flight',
    bookingId: b._id.toHexString(),
    ...(b.reference !== undefined ? { reference: b.reference } : {}),
    userId: b.userId.toHexString(),
    providerId: b.segments[0].airlineId.toHexString(),
    startAt: b.firstDepartureAt,
    endAt: b.lastDepartureAt,
    totalMinor: b.pricing.totalMinor,
    currency: b.pricing.currency,
    status: b.status,
    createdAt: b.createdAt,
  };
}
