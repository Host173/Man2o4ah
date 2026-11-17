import { NotImplementedException } from '@nestjs/common';
import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import type { PaginationQueryDto } from '../../src/common/pagination/pagination-query.dto.js';
import type { CreateItineraryDto } from '../../src/modules/itineraries/dto/create-itinerary.dto.js';
import type { UpdateItineraryDto } from '../../src/modules/itineraries/dto/update-itinerary.dto.js';
import type { ItinerariesService } from '../../src/modules/itineraries/itineraries.service.js';
import type {
  ItineraryDetailView,
  ItinerarySummary,
  PublicItineraryQuery,
  PublicItinerarySummary,
} from '../../src/modules/itineraries/itineraries.types.js';
import type { PublicApi } from './public-api.js';

/**
 * A working `ItinerariesService` for other modules' tests: seeded public
 * itineraries, kept in memory. `listPublicByAuthor` keeps the contract's
 * owner filter, newest-`updatedAt` order and pagination.
 *
 * The owner-only methods (ITN-01) are exercised against the real service in the
 * itineraries module's own tests; other modules never call them, so this fake
 * throws instead of pretending to store documents.
 */
export class FakeItinerariesService implements PublicApi<ItinerariesService> {
  readonly itineraries: PublicItinerarySummary[];

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

  create(
    dto: CreateItineraryDto,
    userId: string,
  ): Promise<ItineraryDetailView> {
    void dto;
    void userId;
    throw new NotImplementedException(
      'create is owner-only; tested against the real service',
    );
  }

  listMine(
    userId: string,
    query?: PaginationQueryDto,
  ): Promise<Paginated<ItinerarySummary>> {
    void userId;
    void query;
    throw new NotImplementedException(
      'listMine is owner-only; tested against the real service',
    );
  }

  getById(itineraryId: string, userId: string): Promise<ItineraryDetailView> {
    void itineraryId;
    void userId;
    throw new NotImplementedException(
      'getById is owner-only; tested against the real service',
    );
  }

  update(
    itineraryId: string,
    dto: UpdateItineraryDto,
    userId: string,
  ): Promise<ItineraryDetailView> {
    void itineraryId;
    void dto;
    void userId;
    throw new NotImplementedException(
      'update is owner-only; tested against the real service',
    );
  }

  delete(itineraryId: string, userId: string): Promise<void> {
    void itineraryId;
    void userId;
    throw new NotImplementedException(
      'delete is owner-only; tested against the real service',
    );
  }
}
