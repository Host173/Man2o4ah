import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import {
  CancellationPolicy,
  CancellationPolicySchema,
} from '../../../common/database/cancellation-policy.schema.js';
import {
  ImageRef,
  ImageRefSchema,
} from '../../../common/database/image-ref.schema.js';
import {
  HH_MM,
  integerValidator,
  maxItemsValidator,
  uniqueValuesValidator,
} from '../../../common/database/validators.js';

/** Average and count of non-hidden reviews, written only by HotelsService.setRatingSummary (HTL-23). */
@Schema({ _id: false })
export class RatingSummary {
  /** null while the hotel has no visible review. */
  @Prop({ type: Number, default: null })
  average!: number | null;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    default: 0,
    validate: integerValidator,
  })
  count!: number;
}

export const RatingSummarySchema = SchemaFactory.createForClass(RatingSummary);

@Schema({ collection: 'hotels', timestamps: true })
export class Hotel {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 150,
  })
  name!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 300,
  })
  address!: string;

  /** → cities (by ID) */
  @Prop({ type: String, required: true })
  cityId!: string;

  /** → countries (by ID); derived from the city by the service, stored for search by country. */
  @Prop({ type: String, required: true })
  countryCode!: string;

  @Prop({ type: String, maxlength: 5000 })
  description?: string;

  /** 0-5 photos (GEN-08). */
  @Prop({
    type: [ImageRefSchema],
    default: [],
    validate: maxItemsValidator(5),
  })
  photos!: ImageRef[];

  @Prop({ type: Number, min: 1, max: 5, validate: integerValidator })
  starRating?: number;

  /** Each trimmed, 1-50 chars, no duplicates. */
  @Prop({
    type: [{ type: String, trim: true, minlength: 1, maxlength: 50 }],
    default: [],
    validate: uniqueValuesValidator,
  })
  amenities!: string[];

  /** HTL-09 */
  @Prop({ type: String, required: true, default: '14:00', match: HH_MM })
  checkInTime!: string;

  @Prop({ type: String, required: true, default: '12:00', match: HH_MM })
  checkOutTime!: string;

  /** daysBefore = days before check-in (HTL-10). */
  @Prop({
    type: CancellationPolicySchema,
    required: true,
    default: () => ({ tiers: [] }),
  })
  cancellationPolicy!: CancellationPolicy;

  /** ACC-15 */
  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  @Prop({
    type: RatingSummarySchema,
    required: true,
    default: () => ({ average: null, count: 0 }),
  })
  ratingSummary!: RatingSummary;
}

export type HotelDocument = HydratedDocument<Hotel>;
export const HotelSchema = SchemaFactory.createForClass(Hotel);
HotelSchema.index({ cityId: 1, isActive: 1 });
HotelSchema.index({ countryCode: 1, isActive: 1 });
HotelSchema.index({ 'ratingSummary.average': -1 });
