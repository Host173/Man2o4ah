import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import type { Model, Types } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { isInvalidTransition, transitionStatus } from './booking-lifecycle.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

/** How often completed stays are finalized (data-model §7). */
const EVERY_HOUR = 60 * 60 * 1000;
const BATCH_SIZE = 100;

interface DueStay {
  _id: Types.ObjectId;
}

/**
 * Completes confirmed hotel stays whose checkout date has passed in UTC
 * (HTL-20, HTL-23, GEN-11): `confirmed` reservations with
 * `checkOutDate < today` (UTC DateOnly) move to `completed` with `completedAt`.
 * Equality does not qualify: a stay checking out today remains `confirmed`.
 * Does not release room-night inventory and does not emit events.
 */
@Injectable()
export class HotelStayCompletionJob {
  private readonly logger = new Logger(HotelStayCompletionJob.name);

  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservationModel: Model<HotelReservation>,
  ) {}

  @Interval(EVERY_HOUR)
  async run(): Promise<void> {
    await this.completeDueStays(new Date());
  }

  /**
   * Completes every confirmed stay whose checkout date is strictly before
   * `now`'s UTC calendar date; returns how many transitions succeeded.
   */
  async completeDueStays(now: Date = new Date()): Promise<number> {
    const today = toDateOnly(now.toISOString().slice(0, 10));
    let completed = 0;
    const failed: Types.ObjectId[] = [];

    for (;;) {
      const batch = await this.reservationModel
        .find(
          {
            _id: { $nin: failed },
            status: HotelReservationStatus.CONFIRMED,
            checkOutDate: { $lt: today },
          },
          { _id: 1 },
        )
        .sort({ checkOutDate: 1, _id: 1 })
        .limit(BATCH_SIZE)
        .lean<DueStay[]>();

      for (const stay of batch) {
        if (await this.complete(stay._id, now, today)) completed += 1;
        else failed.push(stay._id);
      }

      if (batch.length < BATCH_SIZE) return completed;
    }
  }

  private async complete(
    id: Types.ObjectId,
    now: Date,
    today: Date,
  ): Promise<boolean> {
    try {
      await transitionStatus(
        this.reservationModel,
        id,
        HotelReservationStatus.CONFIRMED,
        HotelReservationStatus.COMPLETED,
        { completedAt: now },
        { where: { checkOutDate: { $lt: today } } },
      );
      return true;
    } catch (error) {
      if (isInvalidTransition(error)) return false;
      this.logger.error(
        `Could not complete hotel reservation ${id.toString()}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }
}
