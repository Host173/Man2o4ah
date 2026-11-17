import { NotFoundException } from '@nestjs/common';
import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import { PaginationQueryDto } from '../../src/common/pagination/pagination-query.dto.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type { CreateItineraryDto } from '../../src/modules/itineraries/dto/create-itinerary.dto.js';
import type { UpdateItineraryDto } from '../../src/modules/itineraries/dto/update-itinerary.dto.js';
import type { ItinerariesService } from '../../src/modules/itineraries/itineraries.service.js';
import type {
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
      transportCosts: [],
      isHidden: false,
      authorDeactivated: false,
    };
    this.owned.set(itinerary._id, itinerary);
    return structuredClone(itinerary);
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
    return structuredClone(this.findOwned(itineraryId, userId));
  }

  async update(
    itineraryId: string,
    dto: UpdateItineraryDto,
    userId: string,
  ): Promise<ItineraryDetailView> {
    const itinerary = this.findOwned(itineraryId, userId);
    if (dto.title !== undefined) itinerary.title = dto.title.trim();
    if (dto.countryCodes !== undefined) {
      itinerary.countryCodes = [...dto.countryCodes];
    }
    if (dto.startDate !== undefined) itinerary.startDate = dto.startDate;
    itinerary.updatedAt = new Date();
    return structuredClone(itinerary);
  }

  async delete(itineraryId: string, userId: string): Promise<void> {
    this.findOwned(itineraryId, userId);
    this.owned.delete(itineraryId);
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
