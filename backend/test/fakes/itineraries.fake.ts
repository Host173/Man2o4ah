import { isDeepStrictEqual } from 'node:util';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AddActivityDto } from '../../src/modules/itineraries/dto/add-activity.dto.js';
import { MAX_IMAGES_PER_ITEM } from '../../src/modules/storage/image-rules.js';
import type { UploadedImage } from '../../src/modules/storage/image-rules.js';
import { FakeReferenceDataService } from './reference-data.fake.js';
import { FakeStorageService } from './storage.fake.js';
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
  ActivityView,
  ItineraryDayView,
  ItineraryDetailView,
  ItinerarySummary,
  PublicItineraryQuery,
  PublicItinerarySummary,
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

  /** The storage fake used by the image methods (ITN-12/GEN-08). */
  readonly storage: FakeStorageService;

  constructor(
    itineraries: PublicItinerarySummary[] = [],
    referenceData: FakeReferenceDataService = new FakeReferenceDataService(),
    storage: FakeStorageService = new FakeStorageService(),
  ) {
    // A deep copy, so a test that changes its fixtures can't affect another test.
    this.itineraries = structuredClone(itineraries);
    this.referenceData = referenceData;
    this.storage = storage;
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
    const itinerary = this.findOwned(itineraryId, userId);
    const days = structuredClone(itinerary.days);
    await this.deleteImageFiles(this.imageKeysOf(days));
    const current = this.findOwned(itineraryId, userId);
    if (!isDeepStrictEqual(current.days, days)) {
      throw this.imageCleanupConflict();
    }
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

  /** ITN-10: adds an activity to a day, so ITN-12 can fake image ownership. */
  async addActivity(
    itineraryId: string,
    dayId: string,
    dto: AddActivityDto,
    userId: string,
  ): Promise<ItineraryDayView> {
    const itinerary = this.findOwned(itineraryId, userId);
    const index = itinerary.days.findIndex((day) => day._id === dayId);
    if (index === -1) throw this.activityNotFound();

    const activity: ActivityView = {
      _id: (this.nextId++).toString(16).padStart(24, '0'),
      name: dto.name.trim(),
      images: [],
    };
    if (dto.description !== undefined) activity.description = dto.description;
    if (dto.time !== undefined) activity.time = dto.time;
    if (dto.cost !== undefined && dto.cost !== null) {
      activity.cost = { amountMinor: dto.cost, currency: 'EGP' };
    }
    itinerary.days[index].activities.push(activity);
    itinerary.updatedAt = new Date();
    return structuredClone(this.toDetail(itinerary).days[index]);
  }

  /** ITN-12/GEN-08: attaches one image to the owner's activity. */
  async addActivityImage(
    activityId: string,
    file: UploadedImage | undefined,
    userId: string,
  ): Promise<ItineraryDayView> {
    if (!file)
      throw this.invalidField('file', 'must contain a JPG or PNG image');
    const found = this.findActivity(activityId, userId);
    const images =
      found.itinerary.days[found.dayIndex].activities[found.activityIndex]
        .images;
    if (images.length >= MAX_IMAGES_PER_ITEM) {
      throw this.imageLimitExceeded();
    }
    const stored = await this.storage.save(file);
    try {
      const current = this.findActivity(activityId, userId);
      const activity =
        current.itinerary.days[current.dayIndex].activities[
          current.activityIndex
        ];
      if (activity.images.length >= MAX_IMAGES_PER_ITEM) {
        throw this.imageLimitExceeded();
      }
      activity.images.push({
        _id: stored._id.toHexString(),
        key: stored.key,
        url: this.storage.urlOf(stored.key),
      });
      current.itinerary.updatedAt = new Date();
      return structuredClone(
        this.toDetail(current.itinerary).days[current.dayIndex],
      );
    } catch (error) {
      await this.storage.delete(stored.key);
      throw error;
    }
  }

  /** ITN-12/GEN-08: removes one image from the owner's activity. */
  async removeActivityImage(
    activityId: string,
    imageId: string,
    userId: string,
  ): Promise<void> {
    const found = this.findActivity(activityId, userId);
    const images =
      found.itinerary.days[found.dayIndex].activities[found.activityIndex]
        .images;
    const index = images.findIndex((image) => image._id === imageId);
    if (index === -1) throw this.activityNotFound();
    await this.storage.delete(images[index].key);
    // Re-check after the await: an overlapping removal may have taken it.
    const current = images.findIndex((image) => image._id === imageId);
    if (current === -1) throw this.activityNotFound();
    images.splice(current, 1);
    found.itinerary.updatedAt = new Date();
  }

  private findActivity(
    activityId: string,
    userId: string,
  ): {
    itinerary: ItineraryDetailView;
    dayIndex: number;
    activityIndex: number;
  } {
    for (const itinerary of this.owned.values()) {
      if (itinerary.ownerId !== userId) continue;
      for (let dayIndex = 0; dayIndex < itinerary.days.length; dayIndex++) {
        const activityIndex = itinerary.days[dayIndex].activities.findIndex(
          (activity) => activity._id === activityId,
        );
        if (activityIndex !== -1) {
          return { itinerary, dayIndex, activityIndex };
        }
      }
    }
    throw this.activityNotFound();
  }

  private activityNotFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Itinerary activity not found',
    });
  }

  private imageLimitExceeded(): BadRequestException {
    return new BadRequestException({
      code: ErrorCode.LimitExceeded,
      message: `An activity can have at most ${MAX_IMAGES_PER_ITEM} images`,
    });
  }

  private imageCleanupConflict(): ConflictException {
    return new ConflictException({
      code: ErrorCode.ConcurrentChange,
      message: 'Itinerary changed during image cleanup. Please retry deletion.',
    });
  }

  private imageKeysOf(
    days: readonly { activities: ActivityView[] }[],
  ): string[] {
    return days.flatMap((day) =>
      day.activities.flatMap((activity) =>
        activity.images.map((image) => image.key),
      ),
    );
  }

  private async deleteImageFiles(keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.storage.delete(key)));
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
    const removed = structuredClone(itinerary.days[index]);
    await this.deleteImageFiles(this.imageKeysOf([removed]));
    const current = this.findOwned(itineraryId, userId);
    const currentIndex = current.days.findIndex((day) => day._id === dayId);
    if (currentIndex === -1) throw this.activityNotFound();
    if (!isDeepStrictEqual(current.days[currentIndex], removed)) {
      throw this.imageCleanupConflict();
    }
    // The day's activities and budget entries are embedded in it; transport
    // costs live in a separate array and must be filtered (ITN-07).
    itinerary.days.splice(currentIndex, 1);
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
