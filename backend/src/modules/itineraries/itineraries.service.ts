import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  PublicItineraryQuery,
  PublicItinerarySummary,
} from './itineraries.types.js';

/**
 * What other modules may ask of itineraries (CTR-06). The models stay private:
 * callers get plain views, never Mongoose documents.
 */
@Injectable()
export class ItinerariesService {
  /**
   * BLG-12: an author's public itineraries for the author page, newest
   * `updatedAt` first. Only `visibility: public` itineraries are included, and
   * hidden ones or those of a deactivated author are left out (ITN-20).
   * Returns the shared paginated shape; `page` defaults to 1 and `limit` to 10.
   * Implemented in ITN-20.
   */
  listPublicByAuthor(
    ownerId: string,
    query: PublicItineraryQuery = {},
  ): Promise<Paginated<PublicItinerarySummary>> {
    void ownerId;
    void query;
    throw new NotImplementedException(
      'listPublicByAuthor: implemented in ITN-20',
    );
  }
}
