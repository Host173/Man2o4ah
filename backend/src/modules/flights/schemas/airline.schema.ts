import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import {
  CancellationTier,
  CancellationTierSchema,
  uniqueDaysBeforeValidator,
} from '../../../common/database/cancellation-tier.schema.js';
import {
  ImageRef,
  ImageRefSchema,
} from '../../../common/database/image-ref.schema.js';
import { integerValidator } from '../../../common/database/validators.js';

const AIRLINE_CODE = /^[A-Z0-9]{2,3}$/;

/** Extra-bag rules of an airline (FLT-08). */
@Schema({ _id: false })
export class BaggagePolicy {
  /** Integer > 0, or null when extra bags are not sold. Required when maxExtraBagsPerPassenger > 0. */
  @Prop({
    type: Number,
    min: 1,
    required(this: BaggagePolicy) {
      return this.maxExtraBagsPerPassenger > 0;
    },
    validate: {
      validator: (value: unknown) => value === null || Number.isInteger(value),
      message: '{PATH} must be an integer or null.',
    },
  })
  extraBagPriceMinor!: number | null;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  maxExtraBagsPerPassenger!: number;
}

export const BaggagePolicySchema = SchemaFactory.createForClass(BaggagePolicy);

/** Airline cancellation policy (FLT-09). */
@Schema({ _id: false })
export class CancellationPolicy {
  @Prop({ type: [CancellationTierSchema], validate: uniqueDaysBeforeValidator })
  tiers!: CancellationTier[];
}

export const CancellationPolicySchema =
  SchemaFactory.createForClass(CancellationPolicy);

@Schema({ collection: 'airlines', timestamps: true })
export class Airline {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 100,
  })
  name!: string;

  /** Unique through AirlineSchema.index({ code: 1 }, { unique: true }). */
  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    match: AIRLINE_CODE,
  })
  code!: string;

  /** At most one logo (GEN-08). */
  @Prop({ type: ImageRefSchema })
  logo?: ImageRef;

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  @Prop({
    type: BaggagePolicySchema,
    required: true,
    default: () => ({ extraBagPriceMinor: null, maxExtraBagsPerPassenger: 0 }),
  })
  baggagePolicy!: BaggagePolicy;

  @Prop({
    type: CancellationPolicySchema,
    required: true,
    default: () => ({ tiers: [] }),
  })
  cancellationPolicy!: CancellationPolicy;
}

export type AirlineDocument = HydratedDocument<Airline>;
export const AirlineSchema = SchemaFactory.createForClass(Airline);
AirlineSchema.index({ code: 1 }, { unique: true });
AirlineSchema.index({ isActive: 1 });
