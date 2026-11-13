import { ReportTargetType } from '../schemas/report.schema.js';

export { ReportTargetType };

/**
 * Implemented by content-owning modules (`blog` for `post` and `comment`,
 * `hotel-bookings` for `review`, `itineraries` for `itinerary`); owned by
 * `moderation` (CTR-07, GEN-09, GEN-10).
 */
export interface ReportableContent {
  readonly targetType: ReportTargetType;

  /** Whether the target item exists so a user can report it (GEN-09). */
  exists(id: string): Promise<boolean>;

  /**
   * Hides the target item from public view (`isHidden: true`) when an admin
   * resolves a report (GEN-10). Throws 404 `NOT_FOUND` if it does not exist.
   */
  hide(id: string): Promise<void>;

  /**
   * Permanently deletes the target item when an admin resolves a report
   * (GEN-10). Throws 404 `NOT_FOUND` if it does not exist.
   */
  delete(id: string): Promise<void>;
}

