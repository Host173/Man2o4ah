import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

export const EmailDeliveryKind = {
  NOTIFICATION: 'notification',
  MODERATOR_INVITATION: 'moderator_invitation',
} as const;
export type EmailDeliveryKind =
  (typeof EmailDeliveryKind)[keyof typeof EmailDeliveryKind];

export const EmailDeliveryStatus = {
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
} as const;
export type EmailDeliveryStatus =
  (typeof EmailDeliveryStatus)[keyof typeof EmailDeliveryStatus];

export const EmailDeliveryError = {
  RECIPIENT_MISSING: 'recipient_missing',
  RECIPIENT_LOOKUP_FAILED: 'recipient_lookup_failed',
  SMTP_TRANSIENT: 'smtp_transient',
  SMTP_REJECTED: 'smtp_rejected',
  SMTP_UNKNOWN: 'smtp_unknown',
  NOTIFICATION_MISSING: 'notification_missing',
  ATTEMPTS_EXHAUSTED: 'attempts_exhausted',
} as const;
export type EmailDeliveryError =
  (typeof EmailDeliveryError)[keyof typeof EmailDeliveryError];

/** GEN-01-B: durable retry and deduplication history, owned by notifications. */
@Schema({ collection: 'email_deliveries', timestamps: true })
export class EmailDelivery {
  @Prop({ type: String, required: true, trim: true })
  deliveryKey!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(EmailDeliveryKind),
  })
  kind!: EmailDeliveryKind;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  notificationId?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  invitationEventId?: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(EmailDeliveryStatus),
    default: EmailDeliveryStatus.PENDING,
  })
  status!: EmailDeliveryStatus;

  @Prop({
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: Number.isSafeInteger,
  })
  attempts!: number;

  @Prop({ type: Date, required: true, default: Date.now })
  nextAttemptAt!: Date;

  @Prop({ type: String })
  leaseToken?: string;

  @Prop({ type: Date })
  leaseExpiresAt?: Date;

  @Prop({ type: Date })
  sentAt?: Date;

  @Prop({ type: String, enum: Object.values(EmailDeliveryError) })
  lastError?: EmailDeliveryError;
}

export const EmailDeliverySchema = SchemaFactory.createForClass(EmailDelivery);
EmailDeliverySchema.pre('validate', async function () {
  const notification = this.kind === EmailDeliveryKind.NOTIFICATION;
  if (notification !== Boolean(this.notificationId)) {
    this.invalidate(
      'notificationId',
      'Notification deliveries require notificationId only',
    );
  }
  if (
    notification
      ? this.invitationEventId !== undefined
      : !this.invitationEventId?.trim()
  ) {
    this.invalidate(
      'invitationEventId',
      'Invitations require a non-empty invitationEventId only',
    );
  }
  const sending = this.status === EmailDeliveryStatus.SENDING;
  if (
    sending
      ? !this.leaseToken?.trim() || !this.leaseExpiresAt
      : this.leaseToken !== undefined || this.leaseExpiresAt !== undefined
  ) {
    this.invalidate(
      'leaseToken',
      'Only a sending delivery has a lease token and deadline',
    );
  }
  if (
    this.status === EmailDeliveryStatus.SENT
      ? !this.sentAt
      : this.sentAt !== undefined
  ) {
    this.invalidate('sentAt', 'Only a sent delivery has sentAt');
  }
});
EmailDeliverySchema.index({ deliveryKey: 1 }, { unique: true });
EmailDeliverySchema.index({ status: 1, nextAttemptAt: 1, _id: 1 });
EmailDeliverySchema.index({ status: 1, leaseExpiresAt: 1, _id: 1 });
