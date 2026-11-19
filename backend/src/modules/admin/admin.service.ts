import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingType } from '../../common/database/booking-type.js';
import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { toPage } from '../../common/pagination/paginated.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service.js';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service.js';
import type { AdminBookingView } from './admin.types.js';
import {
  ListAdminBookingsQueryDto,
  MAX_ADMIN_BOOKINGS_DEPTH,
} from './dto/list-admin-bookings-query.dto.js';

/**
 * Admin read-only booking list and platform administration workflows (`ACC-17`).
 * Reads booking data solely through the exported `CTR-04` contracts.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly flightBookingsService: FlightBookingsService,
    private readonly hotelBookingsService: HotelBookingsService,
  ) {}

  /**
   * ACC-17: returns a read-only, paginated list of all flight and hotel
   * bookings sorted newest `createdAt` first (preserving each service's order
   * and flights-before-hotels on equal timestamps), filterable by `type`,
   * `status`, and inclusive `createdAt` date range. Without a `type` filter,
   * `page * limit` is capped at `10000` with `totalPages` clamped to reachable pages.
   */
  async listBookings(
    query: ListAdminBookingsQueryDto = new ListAdminBookingsQueryDto(),
  ): Promise<Paginated<AdminBookingView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const fromStart =
      query.from !== undefined ? this.parseDate(query.from, 'from') : undefined;
    const toStart =
      query.to !== undefined ? this.parseDate(query.to, 'to') : undefined;

    if (fromStart && toStart && fromStart.getTime() > toStart.getTime()) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field: 'from', message: 'from must not be after to' }],
      });
    }

    // End date covers the full UTC calendar day through 23:59:59.999Z.
    const to =
      toStart !== undefined
        ? new Date(addDays(toStart, 1).getTime() - 1)
        : undefined;

    if (query.type === BookingType.FLIGHT) {
      const result = await this.flightBookingsService.listForAdmin({
        status: query.status,
        from: fromStart,
        to,
        page,
        limit,
      });
      return toPage(
        result.items.map((item) => this.toPublicRow(item)),
        result.total,
        page,
        limit,
      );
    }

    if (query.type === BookingType.HOTEL) {
      const result = await this.hotelBookingsService.listForAdmin({
        status: query.status,
        from: fromStart,
        to,
        page,
        limit,
      });
      return toPage(
        result.items.map((item) => this.toPublicRow(item)),
        result.total,
        page,
        limit,
      );
    }

    const fetchLimit = page * limit;
    if (fetchLimit > MAX_ADMIN_BOOKINGS_DEPTH) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          {
            field: 'page',
            message: `page * limit must not exceed ${MAX_ADMIN_BOOKINGS_DEPTH}`,
          },
        ],
      });
    }

    const [flights, hotels] = await Promise.all([
      this.flightBookingsService.listForAdmin({
        status: query.status,
        from: fromStart,
        to,
        page: 1,
        limit: fetchLimit,
      }),
      this.hotelBookingsService.listForAdmin({
        status: query.status,
        from: fromStart,
        to,
        page: 1,
        limit: fetchLimit,
      }),
    ]);

    const merged = [...flights.items, ...hotels.items].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const items = merged
      .slice((page - 1) * limit, fetchLimit)
      .map((item) => this.toPublicRow(item));

    const total = flights.total + hotels.total;
    const pageResult = toPage(items, total, page, limit);
    const maxMergedPages = Math.floor(MAX_ADMIN_BOOKINGS_DEPTH / limit);
    return {
      ...pageResult,
      totalPages: Math.min(pageResult.totalPages, maxMergedPages),
    };
  }

  private parseDate(value: string, field: 'from' | 'to'): Date {
    try {
      return toDateOnly(value);
    } catch {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          {
            field,
            message: `${field} must be a valid calendar date in YYYY-MM-DD format`,
          },
        ],
      });
    }
  }

  private toPublicRow(row: AdminBookingView): AdminBookingView {
    const base = {
      bookingId: row.bookingId,
      ...(row.reference !== undefined ? { reference: row.reference } : {}),
      userId: row.userId,
      providerId: row.providerId,
      startAt: row.startAt,
      endAt: row.endAt,
      totalMinor: row.totalMinor,
      currency: row.currency,
      createdAt: row.createdAt,
    };

    if (row.bookingType === BookingType.FLIGHT) {
      return { ...base, bookingType: BookingType.FLIGHT, status: row.status };
    }
    return { ...base, bookingType: BookingType.HOTEL, status: row.status };
  }
}
