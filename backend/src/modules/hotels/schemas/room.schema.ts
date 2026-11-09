import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { integerValidator } from '../../../common/database/validators.js';
import { dateOnlyValidator } from '../../../common/dates/date-only.js';

/** Bookable nights of a room, both ends inclusive (HTL-04). Keeps its own _id. */
@Schema()
export class AvailabilityRange {
  @Prop({ type: Date, required: true, validate: dateOnlyValidator })
  fromDate!: Date;

  @Prop({
    type: Date,
    required: true,
    validate: [
      dateOnlyValidator,
      {
        validator(this: AvailabilityRange, value: Date) {
          return !(this.fromDate instanceof Date) || value >= this.fromDate;
        },
        message: 'toDate must not be before fromDate.',
      },
    ],
  })
  toDate!: Date;
}

export const AvailabilityRangeSchema =
  SchemaFactory.createForClass(AvailabilityRange);

/**
 * No two ranges share a night. Sorting and merging adjacent ranges is done by
 * the service on save, not checked here.
 */
const nonOverlappingRangesValidator = {
  validator: (ranges: AvailabilityRange[]) => {
    const sorted = ranges
      .filter(
        (range) =>
          range.fromDate instanceof Date && range.toDate instanceof Date,
      )
      .map((range) => ({
        from: range.fromDate.getTime(),
        to: range.toDate.getTime(),
      }))
      .sort((a, b) => a.from - b.from);
    return sorted.every((range, i) => i === 0 || range.from > sorted[i - 1].to);
  },
  message: 'availability ranges must not overlap.',
};

@Schema({ collection: 'rooms', timestamps: true })
export class Room {
  /** → hotels */
  @Prop({ type: Types.ObjectId, required: true })
  hotelId!: Types.ObjectId;

  /** Room number/name; unique within the hotel through the { hotelId, name } index (HTL-03). */
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  /** Free text, e.g. "Deluxe King". */
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 50,
  })
  type!: string;

  @Prop({ type: Number, required: true, min: 1, validate: integerValidator })
  beds!: number;

  @Prop({ type: Number, required: true, min: 1, validate: integerValidator })
  maxOccupancy!: number;

  @Prop({ type: Number, required: true, min: 1, validate: integerValidator })
  pricePerNightMinor!: number;

  /** HTL-06 */
  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  @Prop({
    type: [AvailabilityRangeSchema],
    default: [],
    validate: nonOverlappingRangesValidator,
  })
  availability!: AvailabilityRange[];

  /** Set by RoomNightInventory.reserve; deletion allowed only while false (HTL-06). */
  @Prop({ type: Boolean, required: true, default: false })
  hasEverBeenReserved!: boolean;

  /** Incremented by every inventory operation (data-model 4.2). */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    default: 0,
    validate: integerValidator,
  })
  inventoryVersion!: number;
}

export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);
RoomSchema.index({ hotelId: 1, name: 1 }, { unique: true });
RoomSchema.index({ hotelId: 1, isActive: 1 });
