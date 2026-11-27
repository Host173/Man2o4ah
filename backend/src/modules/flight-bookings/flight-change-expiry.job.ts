import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import type { Connection, Model, Types } from 'mongoose';
import { SeatInventory } from '../flights/seat-inventory.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

/** Same rhythm as the seat-hold expiry (data-model §7). */
const EVERY_30_SECONDS = 30_000;
const BATCH_SIZE = 100;

/** The fields the job needs from a booking whose change is due. */
interface DueChange {
  _id: Types.ObjectId;
  seatCount: number;
  pendingChange: {
    _id: Types.ObjectId;
    segment: { flightId: Types.ObjectId; cabinId: Types.ObjectId };
  };
}

/**
 * Drops unpaid flight changes (FLT-27): a `pendingChange` whose
 * `holdExpiresAt` has passed is removed and its held seats are released, in
 * one transaction per booking. The booking itself is untouched: it keeps its
 * current flight. Safe to run twice and on several app instances: the removal
 * is conditional on that exact change still being pending.
 */
@Injectable()
export class FlightChangeExpiryJob {
  private readonly logger = new Logger(FlightChangeExpiryJob.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    private readonly seatInventory: SeatInventory,
  ) {}

  @Interval(EVERY_30_SECONDS)
  async run(): Promise<void> {
    await this.expireDueChanges(new Date());
  }

  /** Drops every change due at `now`; returns how many were dropped. */
  async expireDueChanges(now: Date): Promise<number> {
    let expired = 0;
    // Changes that couldn't be dropped in this run; the next run retries them.
    const failed: Types.ObjectId[] = [];
    for (;;) {
      const batch = await this.bookingModel
        .find(
          {
            _id: { $nin: failed },
            'pendingChange.holdExpiresAt': { $lte: now },
          },
          {
            seatCount: 1,
            'pendingChange._id': 1,
            'pendingChange.segment.flightId': 1,
            'pendingChange.segment.cabinId': 1,
          },
        )
        .sort({ 'pendingChange.holdExpiresAt': 1 })
        .limit(BATCH_SIZE)
        .lean<DueChange[]>();

      for (const due of batch) {
        if (await this.expire(due)) expired += 1;
        else failed.push(due._id);
      }

      // Every batch holds only new ids, so this always ends.
      if (batch.length < BATCH_SIZE) return expired;
    }
  }

  /** One change: remove it and release its held seats together. */
  private async expire(due: DueChange): Promise<boolean> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const result = await this.bookingModel.updateOne(
          { _id: due._id, 'pendingChange._id': due.pendingChange._id },
          { $unset: { pendingChange: 1 } },
          { session },
        );
        // Lost the race: the change was paid and applied, or dropped meanwhile.
        if (result.modifiedCount !== 1) return false;
        await this.seatInventory.release(
          [
            {
              flightId: due.pendingChange.segment.flightId.toString(),
              cabinId: due.pendingChange.segment.cabinId.toString(),
              seats: due.seatCount,
            },
          ],
          { session },
        );
        return true;
      });
    } catch (error) {
      this.logger.error(
        `Could not drop the pending change of flight booking ${due._id.toString()}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    } finally {
      await session.endSession();
    }
  }
}
