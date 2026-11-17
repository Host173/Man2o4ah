import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import type { Connection, Model, Types } from 'mongoose';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { transitionStatus } from './booking-lifecycle.js';
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

  /** Expires every hold due at `now`; returns how many were expired. */
  async expireDueHolds(now: Date): Promise<number> {
    let expired = 0;
    for (;;) {
      const batch = await this.reservationModel
        .find(
          {
            status: HotelReservationStatus.PENDING_PAYMENT,
            holdExpiresAt: { $lte: now },
          },
          { userId: 1 },
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
      // (so a reservation that keeps failing can't make the job loop forever).
      if (batch.length < BATCH_SIZE || expiredInBatch === 0) return expired;
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
      if (error instanceof ConflictException) return false;
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
