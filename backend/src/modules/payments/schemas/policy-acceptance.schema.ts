import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { BookingType } from '../../../common/database/booking-type.js';

/**
 * The user accepted the booking's policy before paying (PAY-02). The policy itself is the
 * booking's own snapshot, so it is not copied here.
 */
@Schema({ collection: 'policy_acceptances', timestamps: true })
export class PolicyAcceptance {
  @Prop({ type: String, required: true, enum: Object.values(BookingType) })
  bookingType!: BookingType;

  /** → flight_bookings or hotel_reservations, depending on bookingType. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;

  /** → users */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** PAY-02 timestamp. */
  @Prop({ type: Date, required: true })
  acceptedAt!: Date;
}

export type PolicyAcceptanceDocument = HydratedDocument<PolicyAcceptance>;
export const PolicyAcceptanceSchema =
  SchemaFactory.createForClass(PolicyAcceptance);
PolicyAcceptanceSchema.index(
  { bookingType: 1, bookingId: 1 },
  { unique: true },
);
