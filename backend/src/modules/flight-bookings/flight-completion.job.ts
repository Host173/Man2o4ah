import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

/** How often the job looks for finished trips (modules.md §7). */
const EVERY_15_MINUTES = 15 * 60_000;

/**
 * Completes finished trips (GEN-11): `confirmed` bookings whose last segment
 * has departed become `completed`. Nothing else changes (no inventory, no
 * event), so one conditional `updateMany` does it. The `status: confirmed`
 * filter is the lifecycle guard: a cancelled, pending or expired booking with
 * a past departure is never touched, and a second run finds nothing to do.
 */
@Injectable()
export class FlightCompletionJob {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
  ) {}

  @Interval(EVERY_15_MINUTES)
  async run(): Promise<void> {
    await this.completeDepartedBookings(new Date());
  }

  /** Completes every booking whose last departure is at or before `now`; returns how many. */
  async completeDepartedBookings(now: Date): Promise<number> {
    const result = await this.bookingModel.updateMany(
      {
        status: FlightBookingStatus.CONFIRMED,
        lastDepartureAt: { $lte: now },
      },
      { $set: { status: FlightBookingStatus.COMPLETED, completedAt: now } },
      { runValidators: true, strict: 'throw' },
    );
    return result.modifiedCount;
  }
}
