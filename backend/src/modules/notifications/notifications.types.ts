import type { NotificationType } from './schemas/notification.schema.js';

/** What a notification opens, e.g. `{ type: 'flight_booking', id }`. */
export interface NotificationEntityView {
  type: string;
  id: string;
}

/**
 * Plain view of a notification returned by `NotificationsService` and the HTTP
 * endpoints (GEN-01; api-contract.md §3). `userId` is never exposed.
 */
export interface NotificationView {
  _id: string;
  type: NotificationType;
  title: string;
  message: string;
  entity?: NotificationEntityView;
  /** `null` while unread. */
  readAt: string | null;
  createdAt: string;
}
