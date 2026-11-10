import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** 30 days. */
const WEBHOOK_EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * A processed Stripe webhook event. Inserted first: a duplicate-key error on _id means the
 * event was already handled.
 */
@Schema({ collection: 'stripe_webhook_events', timestamps: true })
export class StripeWebhookEvent {
  /** The Stripe event ID. */
  @Prop({ type: String, required: true })
  _id!: string;

  /** e.g. `payment_intent.succeeded` */
  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: Date, required: true })
  receivedAt!: Date;
}

export type StripeWebhookEventDocument = HydratedDocument<StripeWebhookEvent>;
export const StripeWebhookEventSchema =
  SchemaFactory.createForClass(StripeWebhookEvent);
StripeWebhookEventSchema.index(
  { receivedAt: 1 },
  { expireAfterSeconds: WEBHOOK_EVENT_TTL_SECONDS },
);
