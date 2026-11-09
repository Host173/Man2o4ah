import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/** GEN-01 */
export const NotificationType = {
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_CANCELLED: 'booking_cancelled',
  REFUND_UPDATED: 'refund_updated',
  FLIGHT_SCHEDULE_CHANGED: 'flight_schedule_changed',
  FLIGHT_CANCELLED: 'flight_cancelled',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCOUNT_REACTIVATED: 'account_reactivated',
  PROVIDER_DEACTIVATED: 'provider_deactivated',
  PROVIDER_REACTIVATED: 'provider_reactivated',
} as const;
export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

/** What to open, e.g. `{ type: 'flight_booking', id }`. */
@Schema({ _id: false })
export class NotificationEntity {
  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: String, required: true })
  id!: string;
}

export const NotificationEntitySchema =
  SchemaFactory.createForClass(NotificationEntity);

@Schema({ collection: 'notifications', timestamps: true })
export class Notification {
  /** → users (recipient) */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(NotificationType) })
  type!: NotificationType;

  @Prop({ type: String, required: true, maxlength: 100 })
  title!: string;

  @Prop({ type: String, required: true, maxlength: 500 })
  message!: string;

  @Prop({ type: NotificationEntitySchema })
  entity?: NotificationEntity;

  /** null or absent = unread. */
  @Prop({ type: Date })
  readAt?: Date | null;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
