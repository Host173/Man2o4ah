import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingType } from '../../common/database/booking-type.js';
import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { toPage } from '../../common/pagination/paginated.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { ProviderType } from '../accounts/schemas/user.schema.js';
import { AuditAction } from '../audit/schemas/audit-log.schema.js';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service.js';
import { FlightsService } from '../flights/flights.service.js';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service.js';
import { HotelsService } from '../hotels/hotels.service.js';
import type { AdminBookingView } from './admin.types.js';
import {
  ListAdminBookingsQueryDto,
  MAX_ADMIN_BOOKINGS_DEPTH,
} from './dto/list-admin-bookings-query.dto.js';

const OBJECT_ID_HEX_RE = /^[0-9a-fA-F]{24}$/;
const VALID_PROVIDER_TYPES = new Set<string>(Object.values(ProviderType));

/**
 * Admin read-only booking list and provider moderation workflows (`ACC-15`, `ACC-17`).
 * Reads and mutates cross-module data solely through exported module contracts (`CTR-01`..`CTR-04`).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly flightBookingsService: FlightBookingsService,
    private readonly hotelBookingsService: HotelBookingsService,
    private readonly accountsService: AccountsService,
    private readonly flightsService: FlightsService,
    private readonly hotelsService: HotelsService,
    private readonly events: AppEvents,
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

  /**
   * ACC-15: deactivates an airline or hotel via its owning service, resolves
   * its moderators through `AccountsService.getModeratorIds`, and emits
   * `provider.deactivated` and `admin.action` (`PROVIDER_DEACTIVATED`).
   */
  async deactivateProvider(
    type: ProviderType,
    providerId: string,
    adminId: string,
  ): Promise<void> {
    await this.setProviderActive(type, providerId, false, adminId);
  }

  /**
   * ACC-15: reactivates an airline or hotel via its owning service, resolves
   * its moderators through `AccountsService.getModeratorIds`, and emits
   * `provider.reactivated` and `admin.action` (`PROVIDER_REACTIVATED`).
   */
  async reactivateProvider(
    type: ProviderType,
    providerId: string,
    adminId: string,
  ): Promise<void> {
    await this.setProviderActive(type, providerId, true, adminId);
  }

  private async setProviderActive(
    type: ProviderType,
    providerId: string,
    isActive: boolean,
    adminId: string,
  ): Promise<void> {
    if (!VALID_PROVIDER_TYPES.has(type)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field: 'type', message: 'type must be airline or hotel' }],
      });
    }
    if (typeof providerId !== 'string' || !OBJECT_ID_HEX_RE.test(providerId)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid ObjectId' }],
      });
    }

    // Look up recipients before mutating so lookup failures leave provider state untouched.
    const moderatorIds = await this.accountsService.getModeratorIds(
      type,
      providerId,
    );

    if (type === ProviderType.AIRLINE) {
      await this.flightsService.setAirlineActive(providerId, isActive);
    } else {
      await this.hotelsService.setActive(providerId, isActive);
    }

    this.events.emit(
      isActive ? Events.ProviderReactivated : Events.ProviderDeactivated,
      {
        providerType: type,
        providerId,
        moderatorIds,
      },
    );

    this.events.emit(Events.AdminAction, {
      actorId: adminId,
      action: isActive
        ? AuditAction.PROVIDER_REACTIVATED
        : AuditAction.PROVIDER_DEACTIVATED,
      target: { type, id: providerId },
    });
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
