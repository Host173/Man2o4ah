import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { CabinClass } from '../../../common/database/cabin-class.js';
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
  integerValidator,
  itemsBetweenValidator,
  positiveNumberValidator,
} from '../../../common/database/validators.js';
import { dateOnlyValidator } from '../../../common/dates/date-only.js';
import { getPlatformCurrency } from '../../../common/money/platform-currency.js';

export const FlightBookingStatus = {
  PENDING_PAYMENT: 'pending_payment',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;
export type FlightBookingStatus =
  (typeof FlightBookingStatus)[keyof typeof FlightBookingStatus];

export const TripType = {
  ONE_WAY: 'one_way',
  ROUND_TRIP: 'round_trip',
} as const;
export type TripType = (typeof TripType)[keyof typeof TripType];

export const SegmentDirection = {
  OUTBOUND: 'outbound',
  RETURN: 'return',
} as const;
export type SegmentDirection =
  (typeof SegmentDirection)[keyof typeof SegmentDirection];

export const PassengerType = {
  ADULT: 'adult',
  CHILD: 'child',
  INFANT: 'infant',
} as const;
export type PassengerType = (typeof PassengerType)[keyof typeof PassengerType];

const BOOKING_REFERENCE = /^FB[A-Z0-9]{6}$/;

/** Segment directions required for each trip type (outbound first). */
const DIRECTIONS_BY_TRIP_TYPE: Record<TripType, SegmentDirection[]> = {
  [TripType.ONE_WAY]: [SegmentDirection.OUTBOUND],
  [TripType.ROUND_TRIP]: [SegmentDirection.OUTBOUND, SegmentDirection.RETURN],
};

/** Snapshot of the airline/cabin policy at hold time. */
@Schema({ _id: false })
export class SegmentPolicy {
  @Prop({ type: [CancellationTierSchema], validate: uniqueDaysBeforeValidator })
  cancellationTiers!: CancellationTier[];

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  freeBags!: number;

  @Prop({ type: Number, required: true, validate: positiveNumberValidator })
  maxBagWeightKg!: number;

  /** 0 when the airline sells no extra bags. */
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  extraBagPriceMinor!: number;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  maxExtraBagsPerPassenger!: number;
}

export const SegmentPolicySchema = SchemaFactory.createForClass(SegmentPolicy);

/** One flight of the booking, with copies and snapshots. Keeps its own _id. */
@Schema()
export class FlightSegment {
  @Prop({ type: String, required: true, enum: Object.values(SegmentDirection) })
  direction!: SegmentDirection;

  /** → flights */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  flightId!: Types.ObjectId;

  /** _id of the cabin inside that flight. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  cabinId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(CabinClass) })
  cabinClass!: CabinClass;

  /** → airlines */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  airlineId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  flightNumber!: string;

  /** → airports (by ID) */
  @Prop({ type: String, required: true })
  departureAirportId!: string;

  /** → airports (by ID) */
  @Prop({ type: String, required: true })
  arrivalAirportId!: string;

  @Prop({ type: Date, required: true })
  departureAt!: Date;

  @Prop({ type: Date, required: true })
  arrivalAt!: Date;

  /** Price snapshot per seat at hold time. */
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  fareMinor!: number;

  @Prop({ type: SegmentPolicySchema, required: true })
  policy!: SegmentPolicy;
}

export const FlightSegmentSchema = SchemaFactory.createForClass(FlightSegment);

/** Keeps its own _id. Type vs age and dateOfBirth vs today are checked by the service. */
@Schema()
export class Passenger {
  @Prop({ type: String, required: true, enum: Object.values(PassengerType) })
  type!: PassengerType;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 100,
  })
  fullName!: string;

  @Prop({ type: Date, required: true, validate: dateOnlyValidator })
  dateOfBirth!: Date;

  /** Passport or ID number. */
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
  })
  documentNumber!: string;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  extraBagCount!: number;

  /** Weight per extra bag; required and > 0 when extraBagCount > 0. */
  @Prop({
    type: Number,
    min: 0,
    required(this: Passenger) {
      return this.extraBagCount > 0;
    },
    validate: {
      validator(this: Passenger, value: number) {
        return !(this.extraBagCount > 0) || value > 0;
      },
      message:
        'extraBagWeightKg must be greater than 0 when extraBagCount > 0.',
    },
  })
  extraBagWeightKg?: number;
}

export const PassengerSchema = SchemaFactory.createForClass(Passenger);

/** Computed once at hold time, never recomputed (totals not checked here). */
@Schema({ _id: false })
export class FlightBookingPricing {
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  fareTotalMinor!: number;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  baggageTotalMinor!: number;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  totalMinor!: number;

  /** → currencies (by ID); defaults to the platform currency. */
  @Prop({ type: String, required: true, default: () => getPlatformCurrency() })
  currency!: string;
}

export const FlightBookingPricingSchema =
  SchemaFactory.createForClass(FlightBookingPricing);

function countByType(passengers: Passenger[], type: PassengerType): number {
  return passengers.filter((passenger) => passenger.type === type).length;
}

/** A seat hold is a booking in pending_payment (FLT-22). */
@Schema({ collection: 'flight_bookings', timestamps: true })
export class FlightBooking {
  /** → users (owner, ACC-11) */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** Set on confirmation (FLT-23). Unique through a partial index (strings only). */
  @Prop({ type: String, match: BOOKING_REFERENCE })
  reference?: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(FlightBookingStatus),
  })
  status!: FlightBookingStatus;

  @Prop({ type: String, required: true, enum: Object.values(TripType) })
  tripType!: TripType;

  /** 1 for one_way, 2 for round_trip; outbound first, then return. */
  @Prop({
    type: [FlightSegmentSchema],
    validate: [
      itemsBetweenValidator(1, 2),
      {
        validator(this: FlightBooking, segments: FlightSegment[]) {
          const expected = DIRECTIONS_BY_TRIP_TYPE[this.tripType];
          if (!expected) {
            return true; // tripType itself is reported as invalid
          }
          return (
            segments.length === expected.length &&
            segments.every((segment, i) => segment.direction === expected[i])
          );
        },
        message:
          'segments must match tripType: one_way has one outbound segment, round_trip has outbound then return.',
      },
    ],
  })
  segments!: FlightSegment[];

  @Prop({
    type: [PassengerSchema],
    validate: [
      {
        validator: (passengers: Passenger[]) => passengers.length >= 1,
        message: 'passengers must have at least 1 item.',
      },
      {
        validator: (passengers: Passenger[]) =>
          countByType(passengers, PassengerType.ADULT) >= 1,
        message: 'passengers must include at least one adult.',
      },
      {
        validator: (passengers: Passenger[]) =>
          countByType(passengers, PassengerType.INFANT) <=
          countByType(passengers, PassengerType.ADULT),
        message: 'passengers must not have more infants than adults.',
      },
      {
        validator(this: FlightBooking, passengers: Passenger[]) {
          return passengers.every((passenger) =>
            this.segments.every(
              (segment) =>
                passenger.extraBagCount <=
                segment.policy?.maxExtraBagsPerPassenger,
            ),
          );
        },
        message:
          'extraBagCount must not exceed maxExtraBagsPerPassenger of any segment.',
      },
      {
        validator(this: FlightBooking, passengers: Passenger[]) {
          return passengers.every(({ extraBagWeightKg }) =>
            this.segments.every(
              (segment) =>
                extraBagWeightKg == null ||
                extraBagWeightKg <= segment.policy?.maxBagWeightKg,
            ),
          );
        },
        message:
          'extraBagWeightKg must not exceed maxBagWeightKg of any segment.',
      },
    ],
  })
  passengers!: Passenger[];

  /** Adults + children (infants take no seat); same on every segment. */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: [
      integerValidator,
      {
        validator(this: FlightBooking, value: number) {
          return (
            value ===
            countByType(this.passengers, PassengerType.ADULT) +
              countByType(this.passengers, PassengerType.CHILD)
          );
        },
        message: 'seatCount must equal the number of adults and children.',
      },
    ],
  })
  seatCount!: number;

  @Prop({ type: FlightBookingPricingSchema, required: true })
  pricing!: FlightBookingPricing;

  /** createdAt + 10 min, set by the service. */
  @Prop({ type: Date, required: true })
  holdExpiresAt!: Date;

  /** = outbound departureAt, kept in sync by the service. */
  @Prop({ type: Date, required: true })
  firstDepartureAt!: Date;

  /** = last segment departureAt, kept in sync by the service. */
  @Prop({ type: Date, required: true })
  lastDepartureAt!: Date;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: Date })
  expiredAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  /** Set when cancelled. */
  @Prop({ type: CancellationSchema })
  cancellation?: Cancellation;
}

export type FlightBookingDocument = HydratedDocument<FlightBooking>;
export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);
FlightBookingSchema.index(
  { reference: 1 },
  {
    unique: true,
    partialFilterExpression: { reference: { $type: 'string' } },
  },
);
FlightBookingSchema.index({ userId: 1, firstDepartureAt: -1 });
FlightBookingSchema.index({ 'segments.flightId': 1, status: 1 });
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
FlightBookingSchema.index({ status: 1, lastDepartureAt: 1 });
FlightBookingSchema.index({ status: 1, createdAt: -1 });
FlightBookingSchema.index({ createdAt: -1, _id: -1 });
