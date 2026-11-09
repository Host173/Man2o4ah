import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { CabinClass } from '../../../common/database/cabin-class.js';
import {
  YYYY_MM_DD,
  integerValidator,
  maxItemsValidator,
  positiveNumberValidator,
  uniqueByValidator,
} from '../../../common/database/validators.js';

export const FlightStatus = {
  SCHEDULED: 'scheduled',
  CANCELLED: 'cancelled',
  DEPARTED: 'departed',
} as const;
export type FlightStatus = (typeof FlightStatus)[keyof typeof FlightStatus];

/** A cabin of a flight (FLT-04). Keeps its own _id. */
@Schema()
export class Cabin {
  @Prop({ type: String, required: true, enum: Object.values(CabinClass) })
  cabinClass!: CabinClass;

  /** Invariant: totalSeats = availableSeats + heldSeats + bookedSeats. */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: [
      integerValidator,
      {
        validator(this: Cabin, value: number) {
          return (
            value === this.availableSeats + this.heldSeats + this.bookedSeats
          );
        },
        message:
          'totalSeats must equal availableSeats + heldSeats + bookedSeats.',
      },
    ],
  })
  totalSeats!: number;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  availableSeats!: number;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  heldSeats!: number;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  bookedSeats!: number;

  /** Per seat. */
  @Prop({ type: Number, required: true, min: 1, validate: integerValidator })
  priceMinor!: number;

  /** Free bags per passenger. */
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  freeBags!: number;

  /** Per bag; also the limit for extra bags (FLT-08). */
  @Prop({ type: Number, required: true, validate: positiveNumberValidator })
  maxBagWeightKg!: number;
}

export const CabinSchema = SchemaFactory.createForClass(Cabin);

@Schema({ collection: 'flights', timestamps: true })
export class Flight {
  /** → airlines */
  @Prop({ type: Types.ObjectId, required: true })
  airlineId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, uppercase: true })
  flightNumber!: string;

  /** → airports (by ID) */
  @Prop({
    type: String,
    required: true,
    validate: {
      validator(this: Flight, value: string) {
        return value !== this.arrivalAirportId;
      },
      message: 'departureAirportId must differ from arrivalAirportId.',
    },
  })
  departureAirportId!: string;

  /** → airports (by ID) */
  @Prop({ type: String, required: true })
  arrivalAirportId!: string;

  @Prop({ type: Date, required: true })
  departureAt!: Date;

  @Prop({
    type: Date,
    required: true,
    validate: {
      validator(this: Flight, value: Date) {
        return (
          !(this.departureAt instanceof Date) ||
          value.getTime() > this.departureAt.getTime()
        );
      },
      message: 'arrivalAt must be after departureAt.',
    },
  })
  arrivalAt!: Date;

  /** Derived by the service: departureAt in the departure airport's time zone. */
  @Prop({ type: String, required: true, match: YYYY_MM_DD })
  departureLocalDate!: string;

  /** Derived by the service: arrivalAt - departureAt. */
  @Prop({ type: Number, required: true, validate: integerValidator })
  durationMinutes!: number;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(FlightStatus),
    default: FlightStatus.SCHEDULED,
  })
  status!: FlightStatus;

  @Prop({ type: Boolean, required: true, default: false })
  hasBookings!: boolean;

  @Prop({
    type: [CabinSchema],
    validate: [maxItemsValidator(4), uniqueByValidator('cabinClass')],
  })
  cabins!: Cabin[];

  /** Set when the flight is cancelled (FLT-06). */
  @Prop({ type: Date })
  cancelledAt?: Date;
}

export type FlightDocument = HydratedDocument<Flight>;
export const FlightSchema = SchemaFactory.createForClass(Flight);
FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
  { unique: true },
);
FlightSchema.index({
  departureAirportId: 1,
  arrivalAirportId: 1,
  departureLocalDate: 1,
  status: 1,
});
FlightSchema.index({ airlineId: 1, departureAt: 1 });
FlightSchema.index({ status: 1, departureAt: 1 });
