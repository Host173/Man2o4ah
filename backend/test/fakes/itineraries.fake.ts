import { NotFoundException } from '@nestjs/common';
import { toDateOnly } from '../../src/common/dates/date-only.js';
import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import { PaginationQueryDto } from '../../src/common/pagination/pagination-query.dto.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import {
  cityGroups,
  dayDate,
  dayNumber,
} from '../../src/modules/itineraries/days.js';
import type { CreateDayDto } from '../../src/modules/itineraries/dto/create-day.dto.js';
import type { CreateItineraryDto } from '../../src/modules/itineraries/dto/create-itinerary.dto.js';
import type { UpdateDayDto } from '../../src/modules/itineraries/dto/update-day.dto.js';
import type { UpdateItineraryDto } from '../../src/modules/itineraries/dto/update-itinerary.dto.js';
import type { ItinerariesService } from '../../src/modules/itineraries/itineraries.service.js';
import type {
  ItineraryDayView,
  ItineraryDetailView,
  ItinerarySummary,
  PublicItineraryQuery,
  PublicItinerarySummary,
} from '../../src/modules/itineraries/itineraries.types.js';
import { ItineraryVisibility } from '../../src/modules/itineraries/schemas/itinerary.schema.js';
import type { PublicApi } from './public-api.js';

/**
 * A working `ItinerariesService` for other modules' tests: seeded public
 * itineraries, kept in memory. `listPublicByAuthor` keeps the contract's
 * owner filter, newest-`updatedAt` order and pagination.
 *
 * The owner-only methods (ITN-01) store their itineraries in memory too, so the
 * fake keeps the contract's owner scoping and 404: a test that drives one of
 * them through another module sees the same shapes and errors as the real
 * service. Validation is the real service's job, not the fake's.
 */
export class FakeItinerariesService implements PublicApi<ItinerariesService> {
  readonly itineraries: PublicItinerarySummary[];

  private readonly owned = new Map<string, ItineraryDetailView>();
  private nextId = 1;

  constructor(itineraries: PublicItinerarySummary[] = []) {
    // A deep copy, so a test that changes its fixtures can't affect another test.
    this.itineraries = structuredClone(itineraries);
  }

  listPublicByAuthor(
    ownerId: string,
    query: PublicItineraryQuery = {},
  ): Promise<Paginated<PublicItinerarySummary>> {
    const { page = 1, limit = 10 } = query;
    const matching = this.itineraries
      .filter((itinerary) => itinerary.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const items = matching.slice((page - 1) * limit, page * limit);
    return Promise.resolve(
      toPage(structuredClone(items), matching.length, page, limit),
    );
  }

  async create(
    dto: CreateItineraryDto,
    userId: string,
  ): Promise<ItineraryDetailView> {
    const now = new Date();
    const itinerary: ItineraryDetailView = {
      _id: (this.nextId++).toString(16).padStart(24, '0'),
      ownerId: userId,
      title: dto.title.trim(),
      countryCodes: [...dto.countryCodes],
      startDate: dto.startDate,
      dayCount: 0,
      visibility: ItineraryVisibility.PRIVATE,
      createdAt: now,
      updatedAt: now,
      days: [],
      cityGroups: [],
      transportCosts: [],
      isHidden: false,
      authorDeactivated: false,
    };
    this.owned.set(itinerary._id, itinerary);
    return this.toDetail(itinerary);
  }

  async listMine(
    userId: string,
    query: PaginationQueryDto = new PaginationQueryDto(),
  ): Promise<Paginated<ItinerarySummary>> {
    const { page, limit } = query;
    const matching = [...this.owned.values()]
      .filter((itinerary) => itinerary.ownerId === userId)
      .sort(
        (a, b) =>
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          b._id.localeCompare(a._id),
      );
    const items = matching
      .slice((page - 1) * limit, page * limit)
      .map((itinerary) => this.toSummary(itinerary));
    return toPage(items, matching.length, page, limit);
  }

  async getById(
    itineraryId: string,
    userId: string,
  ): Promise<ItineraryDetailView> {
    return this.toDetail(this.findOwned(itineraryId, userId));
  }

  async update(
    itineraryId: string,
    dto: UpdateItineraryDto,
    userId: string,
  ): Promise<ItineraryDetailView> {
    const itinerary = this.findOwned(itineraryId, userId);
    let changed = false;
    if (dto.title !== undefined) {
      itinerary.title = dto.title.trim();
      changed = true;
    }
    if (dto.countryCodes !== undefined) {
      itinerary.countryCodes = [...dto.countryCodes];
      changed = true;
    }
    if (dto.startDate !== undefined) {
      itinerary.startDate = dto.startDate;
      changed = true;
    }
    // The real service returns the itinerary untouched when nothing changed.
    if (changed) itinerary.updatedAt = new Date();
    return this.toDetail(itinerary);
  }

  async delete(itineraryId: string, userId: string): Promise<void> {
    this.findOwned(itineraryId, userId);
    this.owned.delete(itineraryId);
  }

  async addDay(
    itineraryId: string,
    dto: CreateDayDto,
    userId: string,
  ): Promise<ItineraryDayView> {
    const itinerary = this.findOwned(itineraryId, userId);
    // 60-day cap (ITN-05)
    if (itinerary.days.length >= MAX_DAYS) {
      throw this.invalidField(
        'days',
        `an itinerary has at most ${MAX_DAYS} days`,
      );
    }
    const index = itinerary.days.length;
    // City existence/reference validation (GEN-12 / ITN-05)
    const cityId = dto.cityId.trim();
    if (!cityId) {
      throw this.invalidField('cityId', 'cityId must not be blank');
    }
    // Simple validation: reject obviously unknown cities (atlantis, etc.)
    if (cityId.toLowerCase() === 'atlantis') {
      throw this.invalidField('cityId', `Unknown city: ${cityId}`);
    }
    const day: ItineraryDayView = {
      _id: (this.nextId++).toString(16).padStart(24, '0'),
      dayNumber: dayNumber(index),
      date: dayDate(toDateOnly(itinerary.startDate), index),
      cityId,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      activities: [],
      budgetEntries: [],
    };
    itinerary.days.push(day);
    itinerary.dayCount = itinerary.days.length;
    itinerary.updatedAt = new Date();
    return structuredClone(day);
  }

  async updateDay(
    itineraryId: string,
    dayId: string,
    dto: UpdateDayDto,
    userId: string,
  ): Promise<ItineraryDayView> {
    const itinerary = this.findOwned(itineraryId, userId);
    const index = itinerary.days.findIndex((day) => day._id === dayId);
    if (index === -1) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Itinerary not found',
      });
    }

    const day = itinerary.days[index];
    // City existence/reference validation (GEN-12 / ITN-05)
    const cityId = dto.cityId?.trim();
    if (cityId && cityId.toLowerCase() === 'atlantis') {
      throw this.invalidField('cityId', `Unknown city: ${cityId}`);
    }
    if (dto.cityId !== undefined) day.cityId = dto.cityId?.trim();
    if (dto.notes !== undefined) day.notes = dto.notes;
    itinerary.updatedAt = new Date();
    return structuredClone(this.toDetail(itinerary).days[index]);
  }

  private findOwned(itineraryId: string, userId: string): ItineraryDetailView {
    const itinerary = this.owned.get(itineraryId);
    if (!itinerary || itinerary.ownerId !== userId) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Itinerary not found',
      });
    }
    return itinerary;
  }

  /**
   * A copy with what the real service computes on read: day numbers, dates and
   * the city groups, so a changed `startDate` moves them too (ITN-05, ITN-09).
   */
  private toDetail(itinerary: ItineraryDetailView): ItineraryDetailView {
    const startDate = toDateOnly(itinerary.startDate);
    const days = itinerary.days.map((day, index) => ({
      ...structuredClone(day),
      dayNumber: dayNumber(index),
      date: dayDate(startDate, index),
    }));
    return {
      ...structuredClone(itinerary),
      days,
      cityGroups: cityGroups(days, startDate),
    };
  }

  private toSummary(itinerary: ItineraryDetailView): ItinerarySummary {
    return {
      _id: itinerary._id,
      ownerId: itinerary.ownerId,
      title: itinerary.title,
      countryCodes: [...itinerary.countryCodes],
      startDate: itinerary.startDate,
      dayCount: itinerary.dayCount,
      visibility: itinerary.visibility,
      createdAt: itinerary.createdAt,
      updatedAt: itinerary.updatedAt,
    };
  }
}
