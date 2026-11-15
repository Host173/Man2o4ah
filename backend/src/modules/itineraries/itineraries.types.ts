/*
 * The contract types of the itineraries module (CTR-06). Views are plain
 * objects: IDs are strings, never ObjectIds, so other modules and the fakes
 * don't depend on Mongoose. The service maps documents to these views.
 */

/**
 * A public itinerary as the author page (BLG-12) lists it. Days, activities,
 * budgets and transport costs are deliberately left out: open the itinerary
 * itself for those (ITN-21).
 */
export interface PublicItinerarySummary {
  id: string;
  /** The author (the itinerary's `ownerId`). */
  ownerId: string;
  title: string;
  /** → countries (by code). */
  countryCodes: string[];
  /** UTC calendar date, `DateOnly` (ITN-01). */
  startDate: Date;
  /** `days.length` (ITN-05). */
  dayCount: number;
  /** Distinct `days[].cityId`, in no particular order (ITN-09). */
  cityIds: string[];
  /** Sort key of the list (ITN-03). */
  updatedAt: Date;
}

/** Page options for the public itinerary list. Defaults: `page` 1, `limit` 10. */
export interface PublicItineraryQuery {
  /** 1-based. */
  page?: number;
  /** 1-50 (GEN-05). */
  limit?: number;
}
