import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { BookingType } from '../../../common/database/booking-type.js';
import { integerValidator } from '../../../common/database/validators.js';
import { getPlatformCurrency } from '../../../common/money/platform-currency.js';

/** Stripe PaymentIntent status mirrored on the payment (data-model 5.3). */
export const PaymentStatus = {
  PENDING: 'pending',
  FAILED: 'failed',
  SUCCEEDED: 'succeeded',
  CANCELED: 'canceled',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** One Stripe PaymentIntent per booking; stores only what PAY-01 allows. */
@Schema({ collection: 'payments', timestamps: true })
export class Payment {
  @Prop({ type: String, required: true, enum: Object.values(BookingType) })
  bookingType!: BookingType;

  /** → flight_bookings or hotel_reservations, depending on bookingType. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;

  /** → users */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** Unique through the { stripePaymentIntentId } index. */
  @Prop({ type: String, required: true })
  stripePaymentIntentId!: string;

  /** = booking total, checked by the service. */
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  amountMinor!: number;

  /** → currencies (by ID); defaults to the platform currency. */
  @Prop({ type: String, required: true, default: () => getPlatformCurrency() })
  currency!: string;

  @Prop({ type: String, required: true, enum: Object.values(PaymentStatus) })
  status!: PaymentStatus;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ stripePaymentIntentId: 1 }, { unique: true });
PaymentSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });
PaymentSchema.index({ userId: 1 });
