import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { BookingType } from '../../../common/database/booking-type.js';
import { integerValidator } from '../../../common/database/validators.js';

/** `late_payment` = payment succeeded after the hold expired. */
export const RefundReason = {
  USER_CANCELLATION: 'user_cancellation',
  PROVIDER_CANCELLATION: 'provider_cancellation',
  LATE_PAYMENT: 'late_payment',
} as const;
export type RefundReason = (typeof RefundReason)[keyof typeof RefundReason];

/** PAY-03 */
export const RefundStatus = {
  PENDING: 'pending',
  REFUNDED: 'refunded',
  FAILED: 'failed',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

/** One refund per booking (PAY-03). A 0 refund creates no document. */
@Schema({ collection: 'refunds', timestamps: true })
export class Refund {
  /** → payments */
  @Prop({ type: Types.ObjectId, required: true })
  paymentId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(BookingType) })
  bookingType!: BookingType;

  /** → flight_bookings or hotel_reservations, depending on bookingType. */
  @Prop({ type: Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;

  /** → users */
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** Set once Stripe accepts the request; unique when present (partial index). */
  @Prop({ type: String })
  stripeRefundId?: string;

  @Prop({ type: Number, required: true, min: 1, validate: integerValidator })
  amountMinor!: number;

  /** → currencies (by ID); stored explicitly, no default. */
  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: String, required: true, enum: Object.values(RefundReason) })
  reason!: RefundReason;

  @Prop({ type: String, required: true, enum: Object.values(RefundStatus) })
  status!: RefundStatus;
}

export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);
RefundSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });
RefundSchema.index(
  { stripeRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeRefundId: { $type: 'string' } },
  },
);
RefundSchema.index({ userId: 1 });
