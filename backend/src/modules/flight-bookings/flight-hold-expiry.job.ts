import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import type { Connection, Model, Types } from 'mongoose';
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

  /** Expires every hold due at `now`; returns how many were expired. */
  async expireDueHolds(now: Date): Promise<number> {
    let expired = 0;
    for (;;) {
      const batch = await this.bookingModel
        .find(
          {
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

      let expiredInBatch = 0;
      for (const hold of batch) {
        if (await this.expire(hold, now)) expiredInBatch += 1;
      }
      expired += expiredInBatch;

      // Stop when the batch wasn't full, or when nothing in it could be expired
      // (so a booking that keeps failing can't make the job loop forever).
      if (batch.length < BATCH_SIZE || expiredInBatch === 0) return expired;
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
