import {
  BadRequestException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { buildConverter } from '../../src/modules/fx/fx-conversion.js';
import type { Converter } from '../../src/modules/fx/fx.types.js';
import { validateBudgetEntry } from '../../src/modules/itineraries/budget-entries.js';
import { buildBudgetSummary } from '../../src/modules/itineraries/budget-summary.js';
import type { AddActivityDto } from '../../src/modules/itineraries/dto/add-activity.dto.js';
import type { CreateBudgetEntryDto } from '../../src/modules/itineraries/dto/create-budget-entry.dto.js';
import type { CreateTransportCostDto } from '../../src/modules/itineraries/dto/create-transport-cost.dto.js';
import type { UpdateBudgetEntryDto } from '../../src/modules/itineraries/dto/update-budget-entry.dto.js';
import type { UpdateTransportCostDto } from '../../src/modules/itineraries/dto/update-transport-cost.dto.js';
import { validateTransportCost } from '../../src/modules/itineraries/transport-costs.js';
import { FakeReferenceDataService } from './reference-data.fake.js';
import { toDateOnly } from '../../src/common/dates/date-only.js';
import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import { PaginationQueryDto } from '../../src/common/pagination/pagination-query.dto.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import {
  cityGroups,
  dayDate,
  dayNumber,
  orderDaysById,
  withoutTransportCostsOf,
} from '../../src/modules/itineraries/days.js';
import {
  MAX_DAYS,
  MAX_NOTES_LENGTH,
} from '../../src/modules/itineraries/schemas/itinerary.schema.js';
import type { CreateDayDto } from '../../src/modules/itineraries/dto/create-day.dto.js';
import type { CreateItineraryDto } from '../../src/modules/itineraries/dto/create-itinerary.dto.js';
import type { ReorderDaysDto } from '../../src/modules/itineraries/dto/reorder-days.dto.js';
import type { UpdateDayDto } from '../../src/modules/itineraries/dto/update-day.dto.js';
import type { UpdateItineraryDto } from '../../src/modules/itineraries/dto/update-itinerary.dto.js';
import type { ItinerariesService } from '../../src/modules/itineraries/itineraries.service.js';
import type {
  BudgetEntryView,
  BudgetSummaryInput,
  BudgetSummaryView,
  ItineraryDayView,
  ItineraryDetailView,
  ItinerarySummary,
  PublicItineraryQuery,
  PublicItinerarySummary,
  TransportCostView,
} from '../../src/modules/itineraries/itineraries.types.js';
import { ItineraryVisibility } from '../../src/modules/itineraries/schemas/itinerary.schema.js';
import type { PublicApi } from './public-api.js';

function validateNotes(notes: string): string {
  if (typeof notes !== 'string') {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [
        {
          field: 'notes',
          message: 'notes must be a string',
        },
      ],
    });
  }
  if (Array.from(notes).length > MAX_NOTES_LENGTH) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [
        {
          field: 'notes',
          message: `notes must have at most ${MAX_NOTES_LENGTH} characters`,
        },
      ],
    });
  }
  return notes;
}

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

  private readonly referenceData: FakeReferenceDataService;

  constructor(
    itineraries: PublicItinerarySummary[] = [],
    referenceData: FakeReferenceDataService = new FakeReferenceDataService(),
    private readonly converter: Converter = buildConverter({
      rateDate: '2026-11-01',
      rates: { USD: 1, EGP: 50, EUR: 5, JPY: 100 },
      minorUnits: { USD: 2, EGP: 2, EUR: 2, JPY: 0 },
    }),
    private readonly preferredCurrency: string = 'USD',
  ) {
    // A deep copy, so a test that changes its fixtures can't affect another test.
    this.itineraries = structuredClone(itineraries);
    this.referenceData = referenceData;
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
    // City existence/reference validation (GEN-12 / ITN-05)
    if (typeof dto.cityId !== 'string') {
      throw this.invalidField('cityId', 'cityId must be a string');
    }
    const cityId = dto.cityId.trim();
    if (cityId.length === 0) {
      throw this.invalidField('cityId', 'cityId must not be blank');
    }
    const knownCities = await this.referenceData.getCities([cityId]);
    if (!knownCities.has(cityId)) {
      throw this.invalidField('cityId', `Unknown city: ${cityId}`);
    }
    const notes =
      dto.notes !== undefined ? validateNotes(dto.notes) : undefined;
    // 60-day cap (ITN-05), after the city and notes checks like the real service.
    if (itinerary.days.length >= MAX_DAYS) {
      throw this.invalidField(
        'days',
        `an itinerary has at most ${MAX_DAYS} days`,
      );
    }
    const index = itinerary.days.length;
    const day: ItineraryDayView = {
      _id: (this.nextId++).toString(16).padStart(24, '0'),
      dayNumber: dayNumber(index),
      date: dayDate(toDateOnly(itinerary.startDate), index),
      cityId,
      ...(notes !== undefined ? { notes } : {}),
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
    // An empty body returns the day untouched (like the real service).
    if (dto.cityId === undefined && dto.notes === undefined) {
      return structuredClone(this.toDetail(itinerary).days[index]);
    }
    // City existence/reference validation (GEN-12 / ITN-05)
    let nextCityId: string | undefined;
    if (dto.cityId !== undefined) {
      if (typeof dto.cityId !== 'string') {
        throw this.invalidField('cityId', 'cityId must be a string');
      }
      const cityId = dto.cityId.trim();
      if (cityId.length === 0) {
        throw this.invalidField('cityId', 'cityId must not be blank');
      }
      const knownCities = await this.referenceData.getCities([cityId]);
      if (!knownCities.has(cityId)) {
        throw this.invalidField('cityId', `Unknown city: ${cityId}`);
      }
      nextCityId = cityId;
    }
    // Validate notes before mutating, so a failure leaves the day unchanged.
    const notes =
      dto.notes !== undefined ? validateNotes(dto.notes) : undefined;
    if (nextCityId !== undefined) day.cityId = nextCityId;
    if (dto.notes !== undefined) day.notes = notes;
    itinerary.updatedAt = new Date();
    return structuredClone(this.toDetail(itinerary).days[index]);
  }

  /** ITN-10: stub for adding an activity to a day. */
  async addActivity(
    _itineraryId: string,
    _dayId: string,
    _dto: AddActivityDto,
    _userId: string,
  ): Promise<ItineraryDayView> {
    throw new NotImplementedException(
      'addActivity: implemented in ITN-12/GEN-08',
    );
  }

  async deleteDay(
    itineraryId: string,
    dayId: string,
    userId: string,
  ): Promise<void> {
    const itinerary = this.findOwned(itineraryId, userId);
    const index = itinerary.days.findIndex((day) => day._id === dayId);
    if (index === -1) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Itinerary day not found',
      });
    }
    // The day's activities and budget entries are embedded in it; transport
    // costs live in a separate array and must be filtered (ITN-07).
    itinerary.days.splice(index, 1);
    itinerary.transportCosts = withoutTransportCostsOf(
      itinerary.transportCosts,
      dayId,
    );
    itinerary.dayCount = itinerary.days.length;
    itinerary.updatedAt = new Date();
  }

  async reorderDays(
    itineraryId: string,
    dto: ReorderDaysDto,
    userId: string,
  ): Promise<ItineraryDetailView> {
    const itinerary = this.findOwned(itineraryId, userId);
    const days = itinerary.days;
    // Mirror the service's permutation check: the fake must fail with the
    // same 400 VALIDATION_FAILED shape, never a TypeError or a partial write.
    const value = dto?.dayIds;
    if (!Array.isArray(value)) {
      throw this.invalidField('dayIds', 'dayIds must be an array');
    }
    if (value.some((id) => typeof id !== 'string')) {
      throw this.invalidField('dayIds', 'dayIds must contain day IDs');
    }
    const ids = (value as string[]).map((id) => id.toLowerCase());
    if (ids.length !== days.length) {
      throw this.invalidField(
        'dayIds',
        `dayIds must list all ${days.length} days`,
      );
    }
    const known = new Set(days.map((day) => day._id.toLowerCase()));
    if (ids.some((id) => !/^[0-9a-f]{24}$/.test(id) || !known.has(id))) {
      throw this.invalidField('dayIds', 'dayIds must be current day IDs');
    }
    if (new Set(ids).size !== ids.length) {
      throw this.invalidField('dayIds', 'dayIds must not contain duplicates');
    }
    const ordered = orderDaysById(days, ids, (day) => day._id.toLowerCase());
    const unchanged = itinerary.days.every(
      (day, index) => day._id === ordered[index]._id,
    );
    if (!unchanged) {
      itinerary.days = ordered;
      itinerary.dayCount = ordered.length;
      itinerary.updatedAt = new Date();
    }
    return this.toDetail(itinerary);
  }

  /** ITN-14: mirrors the service's ownership, validation and day checks. */
  async addBudgetEntry(
    itineraryId: string,
    dayId: string,
    dto: CreateBudgetEntryDto,
    userId: string,
  ): Promise<BudgetEntryView> {
    const itinerary = this.findOwned(itineraryId, userId);
    await validateBudgetEntry(dto, this.referenceData, true);
    const day = itinerary.days.find((candidate) => candidate._id === dayId);
    if (!day) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Itinerary day not found',
      });
    }
    const entry: BudgetEntryView = {
      _id: (this.nextId++).toString(16).padStart(24, '0'),
      category: dto.category,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      ...(dto.note !== undefined ? { note: dto.note } : {}),
    };
    day.budgetEntries.push(entry);
    itinerary.updatedAt = new Date();
    return structuredClone(entry);
  }

  async updateBudgetEntry(
    budgetId: string,
    dto: UpdateBudgetEntryDto,
    userId: string,
  ): Promise<BudgetEntryView> {
    const { itinerary, entry } = this.findOwnedBudgetEntry(budgetId, userId);
    await validateBudgetEntry(dto, this.referenceData, false);
    for (const field of [
      'category',
      'amountMinor',
      'currency',
      'note',
    ] as const) {
      if (dto[field] !== undefined) {
        Object.assign(entry, { [field]: dto[field] });
        itinerary.updatedAt = new Date();
      }
    }
    return structuredClone(entry);
  }

  async deleteBudgetEntry(budgetId: string, userId: string): Promise<void> {
    const { itinerary, entry } = this.findOwnedBudgetEntry(budgetId, userId);
    for (const day of itinerary.days) {
      day.budgetEntries = day.budgetEntries.filter(
        (candidate) => candidate._id !== entry._id,
      );
    }
    itinerary.updatedAt = new Date();
  }

  /** ITN-14/18: the same pure roll-up and converter as the real service. */
  async getBudgetSummary(
    itineraryId: string,
    userId: string,
  ): Promise<BudgetSummaryView> {
    const itinerary = this.toDetail(this.findOwned(itineraryId, userId));
    const input: BudgetSummaryInput = {
      startDate: toDateOnly(itinerary.startDate),
      days: itinerary.days.map((day) => ({
        _id: day._id,
        cityId: day.cityId,
        budgetEntries: day.budgetEntries,
        activities: day.activities,
      })),
      transportCosts: itinerary.transportCosts.map((cost) => ({
        dayId: cost.dayId,
        amountMinor: cost.amountMinor,
        currency: cost.currency,
      })),
    };
    return buildBudgetSummary(input, this.converter, this.preferredCurrency);
  }

  async addTransportCost(
    itineraryId: string,
    dto: CreateTransportCostDto,
    userId: string,
  ): Promise<TransportCostView> {
    this.findOwned(itineraryId, userId);
    await validateTransportCost(dto, this.referenceData, true);
    const itinerary = this.findOwned(itineraryId, userId);
    if (!itinerary.days.some((day) => day._id === dto.dayId.toLowerCase())) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Itinerary day not found',
      });
    }
    const cost: TransportCostView = {
      _id: (this.nextId++).toString(16).padStart(24, '0'),
      dayId: dto.dayId.toLowerCase(),
      mode: dto.mode,
      fromCityId: dto.fromCityId,
      toCityId: dto.toCityId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
    };
    itinerary.transportCosts.push(cost);
    itinerary.updatedAt = new Date();
    return structuredClone(cost);
  }

  async updateTransportCost(
    costId: string,
    dto: UpdateTransportCostDto,
    userId: string,
  ): Promise<TransportCostView> {
    this.findOwnedTransportCost(costId, userId);
    await validateTransportCost(dto, this.referenceData, false);
    const { itinerary, cost } = this.findOwnedTransportCost(costId, userId);
    if (
      dto.dayId !== undefined &&
      !itinerary.days.some((day) => day._id === dto.dayId?.toLowerCase())
    ) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Itinerary day not found',
      });
    }
    let changed = false;
    for (const field of [
      'mode',
      'fromCityId',
      'toCityId',
      'currency',
    ] as const) {
      if (dto[field] !== undefined) {
        Object.assign(cost, { [field]: dto[field] });
        changed = true;
      }
    }
    if (dto.dayId !== undefined) {
      cost.dayId = dto.dayId.toLowerCase();
      changed = true;
    }
    if (dto.amountMinor !== undefined) {
      cost.amountMinor = dto.amountMinor;
      changed = true;
    }
    if (changed) itinerary.updatedAt = new Date();
    return structuredClone(cost);
  }

  async deleteTransportCost(costId: string, userId: string): Promise<void> {
    const { itinerary, cost } = this.findOwnedTransportCost(costId, userId);
    itinerary.transportCosts = itinerary.transportCosts.filter(
      (entry) => entry._id !== cost._id,
    );
    itinerary.updatedAt = new Date();
  }

  private findOwnedBudgetEntry(
    budgetId: string,
    userId: string,
  ): { itinerary: ItineraryDetailView; entry: BudgetEntryView } {
    if (typeof budgetId !== 'string' || !/^[0-9a-f]{24}$/i.test(budgetId)) {
      this.invalidField('budgetId', 'must be a valid ObjectId');
    }
    for (const itinerary of this.owned.values()) {
      if (itinerary.ownerId !== userId) continue;
      for (const day of itinerary.days) {
        const entry = day.budgetEntries.find(
          (candidate) => candidate._id === budgetId.toLowerCase(),
        );
        if (entry) return { itinerary, entry };
      }
    }
    throw new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Itinerary not found',
    });
  }

  private findOwnedTransportCost(
    costId: string,
    userId: string,
  ): { itinerary: ItineraryDetailView; cost: TransportCostView } {
    if (typeof costId !== 'string' || !/^[0-9a-f]{24}$/i.test(costId)) {
      this.invalidField('costId', 'must be a valid ObjectId');
    }
    for (const itinerary of this.owned.values()) {
      if (itinerary.ownerId !== userId) continue;
      const cost = itinerary.transportCosts.find(
        (entry) => entry._id === costId.toLowerCase(),
      );
      if (cost) return { itinerary, cost };
    }
    throw new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Itinerary not found',
    });
  }

  invalidField(field: string, message: string): never {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [{ field, message }],
    });
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
