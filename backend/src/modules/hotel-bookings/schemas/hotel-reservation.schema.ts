import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import {
  Cancellation,
  CancellationSchema,
} from '../../../common/database/cancellation.schema.js';
import {
  CancellationTier,
  CancellationTierSchema,
  uniqueDaysBeforeValidator,
} from '../../../common/database/cancellation-tier.schema.js';
import {
  HH_MM,
  integerValidator,
  uniqueByValidator,
} from '../../../common/database/validators.js';
import { dateOnlyValidator } from '../../../common/dates/date-only.js';
import { getPlatformCurrency } from '../../../common/money/platform-currency.js';

export const HotelReservationStatus = {
  PENDING_PAYMENT: 'pending_payment',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;
export type HotelReservationStatus =
  (typeof HotelReservationStatus)[keyof typeof HotelReservationStatus];

const RESERVATION_REFERENCE = /^HR[A-Z0-9]{6}$/;

/**
 * One room of the reservation, with snapshots at hold time. Keeps its own _id.
 * adults + childAges.length <= room.maxOccupancy and the subtotal are checked by the service.
 */
@Schema()
export class ReservedRoom {
  /** → rooms */
  @Prop({ type: Types.ObjectId, required: true })
  roomId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  roomName!: string;

  @Prop({ type: String, required: true })
  roomType!: string;

  /** Price snapshot at hold time. */
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  pricePerNightMinor!: number;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  adults!: number;

  /** Each an integer 0-17. */
  @Prop({
    type: [{ type: Number, min: 0, max: 17, validate: integerValidator }],
    default: [],
  })
  childAges!: number[];

  /** nights × pricePerNightMinor, computed by the service. */
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  subtotalMinor!: number;
}

export const ReservedRoomSchema = SchemaFactory.createForClass(ReservedRoom);

/** Hotel policy copied at hold time. */
@Schema({ _id: false })
export class PolicySnapshot {
  @Prop({ type: [CancellationTierSchema], validate: uniqueDaysBeforeValidator })
  cancellationTiers!: CancellationTier[];

  @Prop({ type: String, required: true, match: HH_MM })
  checkInTime!: string;

  @Prop({ type: String, required: true, match: HH_MM })
  checkOutTime!: string;
}

export const PolicySnapshotSchema =
  SchemaFactory.createForClass(PolicySnapshot);

/** A room hold is a reservation in pending_payment (HTL-18). */
@Schema({ collection: 'hotel_reservations', timestamps: true })
export class HotelReservation {
  /** → users (owner) */
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** → hotels; all rooms belong to this hotel (HTL-16, checked by the service). */
  @Prop({ type: Types.ObjectId, required: true })
  hotelId!: Types.ObjectId;

  /** Set on confirmation (HTL-17). Unique through a partial index (strings only). */
  @Prop({ type: String, match: RESERVATION_REFERENCE })
  reference?: string;

  /** GEN-11 */
  @Prop({
    type: String,
    required: true,
    enum: Object.values(HotelReservationStatus),
  })
  status!: HotelReservationStatus;

  /** Not before today (UTC), checked by the service. */
  @Prop({ type: Date, required: true, validate: dateOnlyValidator })
  checkInDate!: Date;

  @Prop({
    type: Date,
    required: true,
    validate: [
      dateOnlyValidator,
      {
        validator(this: HotelReservation, value: Date) {
          return (
            !(this.checkInDate instanceof Date) || value > this.checkInDate
          );
        },
        message: 'checkOutDate must be after checkInDate.',
      },
    ],
  })
  checkOutDate!: Date;

  /** Derived: checkOutDate - checkInDate in days, set by the service. */
  @Prop({ type: Number, required: true, min: 1, validate: integerValidator })
  nights!: number;

  /** At least one room, each roomId once; >= 1 adult overall, >= 1 guest per room (HTL-16). */
  @Prop({
    type: [ReservedRoomSchema],
    validate: [
      {
        validator: (rooms: ReservedRoom[]) => rooms.length >= 1,
        message: 'rooms must have at least 1 item.',
      },
      uniqueByValidator('roomId'),
      {
        validator: (rooms: ReservedRoom[]) =>
          rooms.reduce((sum, room) => sum + room.adults, 0) >= 1,
        message: 'rooms must include at least one adult.',
      },
      {
        validator: (rooms: ReservedRoom[]) =>
          rooms.every((room) => room.adults + room.childAges.length >= 1),
        message: 'every room must have at least one guest.',
      },
    ],
  })
  rooms!: ReservedRoom[];

  /** Sum of subtotalMinor, computed by the service. */
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  totalMinor!: number;

  /** → currencies (by ID); the platform currency. */
  @Prop({ type: String, required: true, default: () => getPlatformCurrency() })
  currency!: string;

  @Prop({ type: PolicySnapshotSchema, required: true })
  policySnapshot!: PolicySnapshot;

  /** createdAt + 10 min, set by the service. */
  @Prop({ type: Date, required: true })
  holdExpiresAt!: Date;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: Date })
  expiredAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  /** Set when cancelled; cancelledBy is always user today (HTL-21). */
  @Prop({ type: CancellationSchema })
  cancellation?: Cancellation;
}

export type HotelReservationDocument = HydratedDocument<HotelReservation>;
export const HotelReservationSchema =
  SchemaFactory.createForClass(HotelReservation);
HotelReservationSchema.index(
  { reference: 1 },
  {
    unique: true,
    partialFilterExpression: { reference: { $type: 'string' } },
  },
);
HotelReservationSchema.index({ userId: 1, checkInDate: -1 });
HotelReservationSchema.index({ hotelId: 1, checkInDate: 1 });
HotelReservationSchema.index({ status: 1, holdExpiresAt: 1 });
HotelReservationSchema.index({ status: 1, checkOutDate: 1 });
HotelReservationSchema.index({ status: 1, createdAt: -1 });
