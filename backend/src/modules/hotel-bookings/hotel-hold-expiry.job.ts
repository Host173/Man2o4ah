import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import type { Connection, Model, QueryFilter, Types } from 'mongoose';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { isInvalidTransition, transitionStatus } from './booking-lifecycle.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

/** How often the job looks for unpaid holds (data-model §7). */
const EVERY_30_SECONDS = 30_000;
const BATCH_SIZE = 100;

/** The fields the job needs from a due hold. */
interface DueHold {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
}

/**
 * Expires unpaid hotel holds (HTL-18, GEN-11): `pending_payment` reservations
 * whose `holdExpiresAt` has passed become `expired` and their room nights are
 * released, in one transaction per reservation. A reservation that changed
 * meanwhile (e.g. the payment webhook confirmed it) is skipped. Safe to run
 * twice and on several app instances: every change is a conditional update.
 */
@Injectable()
export class HotelHoldExpiryJob {
  private readonly logger = new Logger(HotelHoldExpiryJob.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HotelReservation.name)
    private readonly reservationModel: Model<HotelReservation>,
    private readonly roomNights: RoomNightInventory,
    private readonly events: AppEvents,
  ) {}

  @Interval(EVERY_30_SECONDS)
  async run(): Promise<void> {
    await this.expireDueHolds(new Date());
  }

  /**
   * Expires every hold due at `now`; returns how many were expired. `only`
   * narrows it further: the hold service uses it to free just the overdue holds
   * that block the rooms it wants (HTL-18).
   */
  async expireDueHolds(
    now: Date,
    only: QueryFilter<HotelReservation> = {},
  ): Promise<number> {
    let expired = 0;
    // Holds that couldn't be expired in this run. They're skipped by the next
    // batches, so they can't hide the holds behind them; the next run retries them.
    const failed: Types.ObjectId[] = [];
    for (;;) {
      const batch = await this.reservationModel
        .find(
          {
            ...only,
            _id: { $nin: failed },
            status: HotelReservationStatus.PENDING_PAYMENT,
            holdExpiresAt: { $lte: now },
          },
          { userId: 1 },
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

  /** One hold: expire it and release its nights together, then tell payments. */
  private async expire(hold: DueHold, now: Date): Promise<boolean> {
    const reservationId = hold._id.toString();
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await transitionStatus(
          this.reservationModel,
          hold._id,
          HotelReservationStatus.PENDING_PAYMENT,
          HotelReservationStatus.EXPIRED,
          { expiredAt: now },
          { session },
        );
        // Every night carries the reservation's id, so the id is enough.
        await this.roomNights.release(reservationId, { session });
      });
    } catch (error) {
      // Lost the race: the reservation was confirmed or expired by someone else.
      // Only that is expected; any other error (even a 409 from release) is logged.
      if (isInvalidTransition(error)) return false;
      this.logger.error(
        `Could not expire hotel reservation ${reservationId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    } finally {
      await session.endSession();
    }

    // After the commit: an event can't be rolled back.
    this.events.emit(Events.HotelReservationExpired, {
      bookingId: reservationId,
      userId: hold.userId.toString(),
    });
    return true;
  }
}
