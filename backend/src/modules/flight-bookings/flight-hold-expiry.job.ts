import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import type { Connection, Model, QueryFilter, Types } from 'mongoose';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { transitionStatus } from './booking-lifecycle.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

/** How often the job looks for unpaid holds (data-model §7). */
const EVERY_30_SECONDS = 30_000;
const BATCH_SIZE = 100;

/** The fields the job needs from a due hold. */
interface DueHold {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  seatCount: number;
  segments: { flightId: Types.ObjectId; cabinId: Types.ObjectId }[];
}

/**
 * Expires unpaid flight holds (FLT-22, GEN-11): `pending_payment` bookings
 * whose `holdExpiresAt` has passed become `expired` and their seats are
 * released, in one transaction per booking. A booking that changed meanwhile
 * (e.g. the payment webhook confirmed it) is skipped. Safe to run twice and on
 * several app instances: every change is a conditional update.
 */
@Injectable()
export class FlightHoldExpiryJob {
  private readonly logger = new Logger(FlightHoldExpiryJob.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    private readonly seatInventory: SeatInventory,
    private readonly events: AppEvents,
  ) {}

  @Interval(EVERY_30_SECONDS)
  async run(): Promise<void> {
    await this.expireDueHolds(new Date());
  }

  /**
   * Expires every hold due at `now`; returns how many were expired. `only`
   * narrows it further: the hold service uses it to free just the overdue holds
   * on the flights it is about to hold seats on (backend.md §10).
   */
  async expireDueHolds(
    now: Date,
    only: QueryFilter<FlightBooking> = {},
  ): Promise<number> {
    let expired = 0;
    // Holds that couldn't be expired in this run. They're skipped by the next
    // batches, so they can't hide the holds behind them; the next run retries them.
    const failed: Types.ObjectId[] = [];
    for (;;) {
      const batch = await this.bookingModel
        .find(
          {
            ...only,
            _id: { $nin: failed },
            status: FlightBookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $lte: now },
          },
          {
            userId: 1,
            seatCount: 1,
            'segments.flightId': 1,
            'segments.cabinId': 1,
          },
        )
        .sort({ holdExpiresAt: 1 })
        .limit(BATCH_SIZE)
        .lean<DueHold[]>();

      for (const hold of batch) {
        if (await this.expire(hold, now)) expired += 1;
        else failed.push(hold._id);
      }

      // Every batch holds only new ids, so this always ends: a batch that isn't
      // full means nothing is left.
      if (batch.length < BATCH_SIZE) return expired;
    }
  }

  /** One hold: expire it and release its seats together, then tell payments. */
  private async expire(hold: DueHold, now: Date): Promise<boolean> {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await transitionStatus(
          this.bookingModel,
          hold._id,
          FlightBookingStatus.PENDING_PAYMENT,
          FlightBookingStatus.EXPIRED,
          { expiredAt: now },
          { session },
        );
        await this.seatInventory.release(
          hold.segments.map((s) => ({
            flightId: s.flightId.toString(),
            cabinId: s.cabinId.toString(),
            seats: hold.seatCount,
          })),
          { session },
        );
      });
    } catch (error) {
      // Lost the race: the booking was confirmed or expired by someone else.
      if (error instanceof ConflictException) return false;
      this.logger.error(
        `Could not expire flight booking ${hold._id.toString()}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    } finally {
      await session.endSession();
    }

    // After the commit: an event can't be rolled back.
    this.events.emit(Events.FlightBookingExpired, {
      bookingId: hold._id.toString(),
      userId: hold.userId.toString(),
    });
    return true;
  }
}
