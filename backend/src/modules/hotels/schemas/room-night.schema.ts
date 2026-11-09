import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { dateOnlyValidator } from '../../../common/dates/date-only.js';

export const RoomNightKind = {
  RESERVATION: 'reservation',
  BLOCKED: 'blocked',
} as const;
export type RoomNightKind = (typeof RoomNightKind)[keyof typeof RoomNightKind];

/**
 * One document = one room taken for one night. The unique { roomId, date }
 * index is the double-booking guarantee. Written only by RoomNightInventory.
 */
@Schema({ collection: 'room_nights', timestamps: true })
export class RoomNight {
  /** → rooms */
  @Prop({ type: Types.ObjectId, required: true })
  roomId!: Types.ObjectId;

  /** → hotels; copy, for per-hotel queries. */
  @Prop({ type: Types.ObjectId, required: true })
  hotelId!: Types.ObjectId;

  /** The night. */
  @Prop({ type: Date, required: true, validate: dateOnlyValidator })
  date!: Date;

  @Prop({ type: String, required: true, enum: Object.values(RoomNightKind) })
  kind!: RoomNightKind;

  /** → hotel_reservations; required when kind = reservation, absent otherwise. */
  @Prop({
    type: Types.ObjectId,
    required(this: RoomNight) {
      return this.kind === RoomNightKind.RESERVATION;
    },
    validate: {
      validator(this: RoomNight, value: unknown) {
        return value == null || this.kind === RoomNightKind.RESERVATION;
      },
      message: 'reservationId must be absent unless kind is reservation.',
    },
  })
  reservationId?: Types.ObjectId;

  /** Groups the nights of one blocked range (HTL-06); required when kind = blocked, absent otherwise. */
  @Prop({
    type: Types.ObjectId,
    required(this: RoomNight) {
      return this.kind === RoomNightKind.BLOCKED;
    },
    validate: {
      validator(this: RoomNight, value: unknown) {
        return value == null || this.kind === RoomNightKind.BLOCKED;
      },
      message: 'blockId must be absent unless kind is blocked.',
    },
  })
  blockId?: Types.ObjectId;
}

export type RoomNightDocument = HydratedDocument<RoomNight>;
export const RoomNightSchema = SchemaFactory.createForClass(RoomNight);
RoomNightSchema.index({ roomId: 1, date: 1 }, { unique: true });
RoomNightSchema.index({ hotelId: 1, date: 1 });
RoomNightSchema.index({ reservationId: 1 });
RoomNightSchema.index({ blockId: 1 });
