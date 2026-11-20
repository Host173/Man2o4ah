import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingType } from '../../common/database/booking-type.js';
import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { toPage } from '../../common/pagination/paginated.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { AccountsService } from '../accounts/accounts.service.js';
import type { AccountListItem } from '../accounts/accounts.types.js';
import {
  isValidPassword,
  PASSWORD_RULE_MESSAGE,
} from '../accounts/auth/password-rule.js';
import {
  ProviderType,
  UserRole,
  UserStatus,
} from '../accounts/schemas/user.schema.js';
import { AuditAction } from '../audit/audit.types.js';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service.js';
import { FlightsService } from '../flights/flights.service.js';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { ListReportsQueryDto } from '../moderation/dto/list-reports-query.dto.js';
import type { ResolveReportDto } from '../moderation/dto/resolve-report.dto.js';
import { ModerationService } from '../moderation/moderation.service.js';
import type { ReportView } from '../moderation/moderation.types.js';
import type { ReportTargetType } from '../moderation/schemas/report.schema.js';
import type { AdminBookingView } from './admin.types.js';
import type { CreateModeratorDto } from './dto/create-moderator.dto.js';
import { ListAdminAccountsQueryDto } from './dto/list-admin-accounts-query.dto.js';
import {
  ListAdminBookingsQueryDto,
  MAX_ADMIN_BOOKINGS_DEPTH,
} from './dto/list-admin-bookings-query.dto.js';
import type { ResetUserPasswordDto } from './dto/reset-user-password.dto.js';

const OBJECT_ID_HEX_RE = /^[0-9a-fA-F]{24}$/;
const VALID_ROLES = new Set<string>(Object.values(UserRole));
const VALID_STATUSES = new Set<string>(Object.values(UserStatus));
const VALID_PROVIDER_TYPES = new Set<string>(Object.values(ProviderType));

/**
 * Admin read-only booking list, account management, provider moderation, and
 * moderation delegation (`ACC-07a`, `ACC-13`, `ACC-14`, `ACC-15`, `ACC-16`,
 * `ACC-17`, `GEN-10`).
 * Reads and mutates external data solely through exported module contracts (`CTR-01`..`CTR-04`).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly flightBookingsService: FlightBookingsService,
    private readonly hotelBookingsService: HotelBookingsService,
    private readonly moderationService: ModerationService,
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

  /** GEN-10: delegates paginated report listing to `ModerationService`. */
  listReports(
    query: ListReportsQueryDto = new ListReportsQueryDto(),
  ): Promise<Paginated<ReportView>> {
    return this.moderationService.listReports(query);
  }

  /** GEN-10: delegates report resolution to `ModerationService`. */
  resolveReport(
    reportId: string,
    dto: ResolveReportDto,
    adminId: string,
  ): Promise<ReportView> {
    return this.moderationService.resolveReport(reportId, dto, adminId);
  }

  /** GEN-10: delegates direct content hiding to `ModerationService`. */
  hideContent(
    targetType: ReportTargetType,
    targetId: string,
    adminId: string,
  ): Promise<void> {
    return this.moderationService.hideContent(targetType, targetId, adminId);
  }

  /** GEN-10: delegates direct content deletion to `ModerationService`. */
  deleteContent(
    targetType: ReportTargetType,
    targetId: string,
    adminId: string,
  ): Promise<void> {
    return this.moderationService.deleteContent(targetType, targetId, adminId);
  }

  /**
   * ACC-14: delegates paginated, searchable, filterable account listing to
   * `AccountsService.listAccounts` (`CTR-01`).
   */
  async listAccounts(
    query: ListAdminAccountsQueryDto = new ListAdminAccountsQueryDto(),
  ): Promise<Paginated<AccountListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    if (query.role !== undefined && !VALID_ROLES.has(query.role)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field: 'role', message: 'role must be a valid UserRole' }],
      });
    }
    if (query.status !== undefined && !VALID_STATUSES.has(query.status)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          { field: 'status', message: 'status must be a valid UserStatus' },
        ],
      });
    }

    const q = query.q?.trim();
    const result = await this.accountsService.listAccounts({
      page,
      limit,
      ...(q ? { q } : {}),
      ...(query.role !== undefined ? { role: query.role } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    });

    return {
      ...result,
      items: result.items.map((item) => this.toPublicAccountItem(item)),
    };
  }

  /**
   * ACC-13: verifies the target airline (`FlightsService.getAirline`) or hotel
   * (`HotelsService.getHotel`) exists, delegates moderator creation to
   * `AccountsService.createModerator`, and emits `AuditAction.MODERATOR_CREATED`.
   */
  async createModerator(
    dto: CreateModeratorDto,
    adminId: string,
  ): Promise<AccountListItem> {
    this.assertObjectId(dto.providerId, 'providerId');
    this.assertValidTemporaryPassword(dto.temporaryPassword);

    if (dto.role === UserRole.AIRLINE_MODERATOR) {
      const airline = await this.flightsService.getAirline(dto.providerId);
      if (!airline) {
        throw new NotFoundException({
          code: ErrorCode.NotFound,
          message: 'Airline not found',
        });
      }
    } else if (dto.role === UserRole.HOTEL_MODERATOR) {
      const hotel = await this.hotelsService.getHotel(dto.providerId);
      if (!hotel) {
        throw new NotFoundException({
          code: ErrorCode.NotFound,
          message: 'Hotel not found',
        });
      }
    } else {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          {
            field: 'role',
            message: 'role must be airline_moderator or hotel_moderator',
          },
        ],
      });
    }

    const created = await this.accountsService.createModerator({
      name: dto.name.trim(),
      email: dto.email.trim().toLowerCase(),
      role: dto.role,
      providerId: dto.providerId,
      temporaryPassword: dto.temporaryPassword,
    });

    const providerType =
      created.moderatorOf?.providerType ??
      (dto.role === UserRole.AIRLINE_MODERATOR
        ? ProviderType.AIRLINE
        : ProviderType.HOTEL);

    this.events.emit(Events.AdminAction, {
      eventId: randomUUID(),
      actorId: adminId,
      action: AuditAction.MODERATOR_CREATED,
      target: { type: 'user', id: created.id },
      details: {
        role: created.role,
        providerType,
        providerId: dto.providerId,
      },
    });

    return this.toPublicAccountItem(created);
  }

  /**
   * ACC-07a: validates the temporary password, delegates reset to
   * `AccountsService.resetPassword`, and emits `AuditAction.PASSWORD_RESET`.
   */
  async resetUserPassword(
    userId: string,
    dto: ResetUserPasswordDto,
    adminId: string,
  ): Promise<void> {
    this.assertObjectId(userId, 'id');
    this.assertValidTemporaryPassword(dto.temporaryPassword);

    await this.accountsService.resetPassword(userId, dto.temporaryPassword);

    this.events.emit(Events.AdminAction, {
      eventId: randomUUID(),
      actorId: adminId,
      action: AuditAction.PASSWORD_RESET,
      target: { type: 'user', id: userId },
    });
  }

  /**
   * ACC-15 / ACC-16: delegates suspension (`active -> suspended`) to
   * `AccountsService.suspend` and emits `AuditAction.ACCOUNT_SUSPENDED`.
   */
  async suspendAccount(userId: string, adminId: string): Promise<void> {
    this.assertObjectId(userId, 'id');
    await this.accountsService.suspend(userId);

    this.events.emit(Events.AdminAction, {
      eventId: randomUUID(),
      actorId: adminId,
      action: AuditAction.ACCOUNT_SUSPENDED,
      target: { type: 'user', id: userId },
    });
  }

  /**
   * ACC-15 / ACC-16: delegates reactivation (`suspended -> active`) to
   * `AccountsService.reactivate` and emits `AuditAction.ACCOUNT_REACTIVATED`.
   */
  async reactivateAccount(userId: string, adminId: string): Promise<void> {
    this.assertObjectId(userId, 'id');
    await this.accountsService.reactivate(userId);

    this.events.emit(Events.AdminAction, {
      eventId: randomUUID(),
      actorId: adminId,
      action: AuditAction.ACCOUNT_REACTIVATED,
      target: { type: 'user', id: userId },
    });
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
    this.assertObjectId(providerId, 'id');

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
        eventId: randomUUID(),
        providerType: type,
        providerId,
        moderatorIds,
      },
    );

    this.events.emit(Events.AdminAction, {
      eventId: randomUUID(),
      actorId: adminId,
      action: isActive
        ? AuditAction.PROVIDER_REACTIVATED
        : AuditAction.PROVIDER_DEACTIVATED,
      target: { type, id: providerId },
    });
  }

  private assertObjectId(value: string, field: string): void {
    if (typeof value !== 'string' || !OBJECT_ID_HEX_RE.test(value)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field, message: `${field} must be a valid ObjectId` }],
      });
    }
  }

  private assertValidTemporaryPassword(temporaryPassword: unknown): void {
    if (
      typeof temporaryPassword !== 'string' ||
      !isValidPassword(temporaryPassword)
    ) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          {
            field: 'temporaryPassword',
            message: PASSWORD_RULE_MESSAGE,
          },
        ],
      });
    }
  }

  private toPublicAccountItem(item: AccountListItem): AccountListItem {
    return {
      id: item.id,
      name: item.name,
      email: item.email,
      role: item.role,
      status: item.status,
      ...(item.moderatorOf !== undefined
        ? {
            moderatorOf: {
              providerType: item.moderatorOf.providerType,
              providerId: item.moderatorOf.providerId,
            },
          }
        : {}),
      createdAt: item.createdAt,
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
