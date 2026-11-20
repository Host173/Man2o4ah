import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { integerValidator } from '../../../common/database/validators.js';

/** One review per completed reservation (HTL-23). */
@Schema({ collection: 'reviews', timestamps: true })
export class Review {
  /** → hotel_reservations; unique through the { reservationId } index. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  reservationId!: Types.ObjectId;

  /** → hotels; copy. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  hotelId!: Types.ObjectId;

  /** → users; must own the reservation (checked by the service). */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: 5,
    validate: integerValidator,
  })
  rating!: number;

  @Prop({ type: String, maxlength: 1000 })
  text?: string;

  /** HTL-26: one reply, replaced when the hotel's moderator submits again. */
  @Prop({ type: String, maxlength: 1000 })
  reply?: string;

  /** GEN-10 */
  @Prop({ type: Boolean, required: true, default: false })
  isHidden!: boolean;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ reservationId: 1 }, { unique: true });
ReviewSchema.index({ hotelId: 1, createdAt: -1 });
ReviewSchema.index({ userId: 1 });
