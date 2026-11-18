import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
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
import { dateOnlyValidator } from '../../../common/dates/date-only.js';

export const ItineraryVisibility = {
  PRIVATE: 'private',
  PUBLIC: 'public',
} as const;
export type ItineraryVisibility =
  (typeof ItineraryVisibility)[keyof typeof ItineraryVisibility];

export const BudgetCategory = {
  FOOD: 'food',
  ACCOMMODATION: 'accommodation',
  IN_CITY_TRANSPORT: 'in_city_transport',
  ACTIVITIES: 'activities',
} as const;
export type BudgetCategory =
  (typeof BudgetCategory)[keyof typeof BudgetCategory];

export const TransportMode = {
  FLIGHT: 'flight',
  TRAIN: 'train',
  BUS: 'bus',
  CAR: 'car',
  FERRY: 'ferry',
  OTHER: 'other',
} as const;
export type TransportMode = (typeof TransportMode)[keyof typeof TransportMode];

const MAX_DAYS = 60;

/** Cost of an activity, counted under Activities in the budget summary. */
@Schema({ _id: false })
export class ActivityCost {
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  amountMinor!: number;

  /** → currencies (by ID) */
  @Prop({ type: String, required: true })
  currency!: string;
}

export const ActivityCostSchema = SchemaFactory.createForClass(ActivityCost);

/**
 * ITN-10, ITN-12. Keeps its own _id.
 * "attraction is in the day's city" is checked by the service.
 */
@Schema()
export class Activity {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 100,
  })
  name!: string;

  @Prop({ type: String, maxlength: 1000 })
  description?: string;

  @Prop({ type: String, match: HH_MM })
  time?: string;

  @Prop({ type: ActivityCostSchema })
  cost?: ActivityCost;

  /** 0-5 images (GEN-08). */
  @Prop({
    type: [ImageRefSchema],
    default: [],
    validate: maxItemsValidator(5),
  })
  images!: ImageRef[];

  /** → attractions (by ID) */
  @Prop({ type: String })
  attractionId?: string;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);

/** ITN-14. Keeps its own _id. */
@Schema()
export class BudgetEntry {
  @Prop({ type: String, required: true, enum: Object.values(BudgetCategory) })
  category!: BudgetCategory;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  amountMinor!: number;

  /** → currencies (by ID) */
  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: String, maxlength: 200 })
  note?: string;
}

export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);

/** Day number (index + 1) and date (startDate + index) are never stored. Keeps its own _id. */
@Schema()
export class Day {
  /** → cities (by ID), ITN-09 */
  @Prop({ type: String, required: true })
  cityId!: string;

  @Prop({ type: String, maxlength: 2000 })
  notes?: string;

  @Prop({ type: [ActivitySchema], default: [] })
  activities!: Activity[];

  @Prop({ type: [BudgetEntrySchema], default: [] })
  budgetEntries!: BudgetEntry[];
}

export const DaySchema = SchemaFactory.createForClass(Day);

/** Intercity transport cost (ITN-16). Keeps its own _id. */
@Schema()
export class TransportCost {
  /** = the _id of one of this itinerary's days (checked on the itinerary). */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  dayId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(TransportMode) })
  mode!: TransportMode;

  /** → cities (by ID) */
  @Prop({ type: String, required: true })
  fromCityId!: string;

  /** → cities (by ID) */
  @Prop({ type: String, required: true })
  toCityId!: string;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  amountMinor!: number;

  /** → currencies (by ID) */
  @Prop({ type: String, required: true })
  currency!: string;
}

export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);

/** Attribution of a clone (ITN-21); kept even if the original is deleted. */
@Schema({ _id: false })
export class ClonedFrom {
  /** → itineraries */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  itineraryId!: Types.ObjectId;

  /** → users */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  authorId!: Types.ObjectId;
}

export const ClonedFromSchema = SchemaFactory.createForClass(ClonedFrom);

/** Everything the itinerary owns is embedded; day order is the array order. */
@Schema({ collection: 'itineraries', timestamps: true })
export class Itinerary {
  /** → users (owner) */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  ownerId!: Types.ObjectId;

  /** ITN-01: trimmed, 1-100 characters (code points, so an emoji is one). */
  @Prop({
    type: String,
    required: true,
    trim: true,
    validate: [
      {
        validator: (title: string) => Array.from(title).length >= 1,
        message: 'title must have at least 1 character.',
      },
      {
        validator: (title: string) => Array.from(title).length <= 100,
        message: 'title must have at most 100 characters.',
      },
    ],
  })
  title!: string;

  /** → countries (by ID); at least one, no duplicates. */
  @Prop({
    type: [String],
    validate: [
      {
        validator: (codes: string[]) => codes.length >= 1,
        message: 'countryCodes must have at least 1 item.',
      },
      uniqueValuesValidator,
    ],
  })
  countryCodes!: string[];

  @Prop({ type: Date, required: true, validate: dateOnlyValidator })
  startDate!: Date;

  /** ITN-01, ITN-20 */
  @Prop({
    type: String,
    required: true,
    enum: Object.values(ItineraryVisibility),
    default: ItineraryVisibility.PRIVATE,
  })
  visibility!: ItineraryVisibility;

  /** Set by an admin (GEN-10). */
  @Prop({ type: Boolean, required: true, default: false })
  isHidden!: boolean;

  /** Set on user.deactivated / user.reactivated (ACC-12). */
  @Prop({ type: Boolean, required: true, default: false })
  authorDeactivated!: boolean;

  @Prop({ type: ClonedFromSchema })
  clonedFrom?: ClonedFrom;

  /** 0-60 days (ITN-05). */
  @Prop({
    type: [DaySchema],
    default: [],
    validate: maxItemsValidator(MAX_DAYS),
  })
  days!: Day[];

  /** Each dayId must be the _id of one of this itinerary's days. */
  @Prop({
    type: [TransportCostSchema],
    default: [],
    validate: {
      validator(this: Itinerary, costs: TransportCost[]) {
        const dayIds = new Set(
          (this.days ?? []).map((day) =>
            String((day as Day & { _id: Types.ObjectId })._id),
          ),
        );
        return costs.every((cost) => dayIds.has(String(cost.dayId)));
      },
      message: 'every transportCosts dayId must be the _id of a day.',
    },
  })
  transportCosts!: TransportCost[];

  /** Derived: days.length, set by the service on every write to days. */
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  dayCount!: number;

  /** Derived: distinct days[].cityId, set by the service on every write to days. */
  @Prop({ type: [String], required: true })
  cityIds!: string[];
}

export type ItineraryDocument = HydratedDocument<Itinerary>;
export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);
ItinerarySchema.index({ ownerId: 1, updatedAt: -1 });
ItinerarySchema.index({
  visibility: 1,
  isHidden: 1,
  authorDeactivated: 1,
  updatedAt: -1,
});
ItinerarySchema.index({ countryCodes: 1 });
ItinerarySchema.index({ cityIds: 1 });
ItinerarySchema.index({ 'days.activities._id': 1 });
ItinerarySchema.index({ 'days.budgetEntries._id': 1 });
ItinerarySchema.index({ 'transportCosts._id': 1 });
