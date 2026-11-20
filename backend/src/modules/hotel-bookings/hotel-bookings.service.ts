import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter, Types } from 'mongoose';
import { paginate } from '../../common/pagination/paginate.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  AdminHotelReservationQuery,
  HotelReservationAdminView,
} from './hotel-bookings.types.js';
import {
  HotelReservation,
  type HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

/** The fields `.lean()` returns for an admin row: no rooms, guests or policy snapshot. */
interface LeanAdminReservation {
  _id: Types.ObjectId;
  reference?: string;
  userId: Types.ObjectId;
  hotelId: Types.ObjectId;
  status: HotelReservationStatus;
  checkInDate: Date;
  checkOutDate: Date;
  totalMinor: number;
  currency: string;
  createdAt: Date;
}

/** Only the fields the read-only admin list shows; nothing client-supplied is echoed back. */
const ADMIN_PROJECTION = {
  reference: 1,
  userId: 1,
  hotelId: 1,
  status: 1,
  checkInDate: 1,
  checkOutDate: 1,
  totalMinor: 1,
  currency: 1,
  createdAt: 1,
} as const;

/** Newest first, with `_id` as a deterministic tie-break (same as other booking lists). */
const ADMIN_SORT = { createdAt: -1, _id: -1 } as const;

@Injectable()
export class HotelBookingsService {
  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservation>,
  ) {}

  /** ACC-17: every hotel reservation for the admin list, newest `createdAt` first. Read-only. */
  async listForAdmin(
    query: AdminHotelReservationQuery,
  ): Promise<Paginated<HotelReservationAdminView>> {
    const filter: QueryFilter<HotelReservation> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.from !== undefined || query.to !== undefined) {
      filter.createdAt = {
        ...(query.from !== undefined ? { $gte: query.from } : {}),
        ...(query.to !== undefined ? { $lte: query.to } : {}),
      };
    }

    const page = await paginate(this.reservations, filter, query, {
      sort: ADMIN_SORT,
      projection: ADMIN_PROJECTION,
    });
    return {
      ...page,
      items: page.items.map((item) =>
        toAdminView(item as unknown as LeanAdminReservation),
      ),
    };
  }
}

function toAdminView(b: LeanAdminReservation): HotelReservationAdminView {
  return {
    bookingType: 'hotel',
    bookingId: b._id.toHexString(),
    ...(b.reference !== undefined ? { reference: b.reference } : {}),
    userId: b.userId.toHexString(),
    providerId: b.hotelId.toHexString(),
    startAt: b.checkInDate,
    endAt: b.checkOutDate,
    totalMinor: b.totalMinor,
    currency: b.currency,
    status: b.status,
    createdAt: b.createdAt,
  };
}
