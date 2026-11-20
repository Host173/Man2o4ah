import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model, QueryFilter } from 'mongoose';
import { AppEvents } from '../../common/events/app-events.service.js';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import { Events } from '../../common/events/events.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

const BATCH_SIZE = 100;

/** Only these still matter: a completed, expired or cancelled booking keeps the times it had. */
const ACTIVE = [
  FlightBookingStatus.PENDING_PAYMENT,
  FlightBookingStatus.CONFIRMED,
];

interface SyncedBooking {
  userId: Types.ObjectId;
  status: FlightBookingStatus;
  segments: { departureAt: Date }[];
}

/**
 * FLT-05, bookings side: when a moderator moves a flight, every pending or
 * confirmed booking containing it copies the new `departureAt` and `arrivalAt`
 * into its segment and re-derives `firstDepartureAt` and `lastDepartureAt`, so
 * refund tiers, the "my bookings" groups and the completion job all use the new
 * dates. Confirmed passengers are then notified. The event carries the new
 * times themselves (not a difference), and only bookings that still differ are
 * touched, so a redelivered event does nothing and notifies nobody twice.
 */
@Injectable()
export class FlightRescheduleSyncService {
  private readonly logger = new Logger(FlightRescheduleSyncService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly events: AppEvents,
  ) {}

  /** Handles `flight.rescheduled`. A listener must not throw: it logs instead. */
  @OnEvent(Events.FlightRescheduled)
  async onFlightRescheduled(
    payload: PayloadOf<typeof Events.FlightRescheduled>,
  ): Promise<void> {
    try {
      await this.sync(payload);
    } catch (error) {
      this.logger.error(
        `Could not sync the bookings of rescheduled flight ${payload.flightId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Syncs every active booking of the flight to the new times. Idempotent. */
  async sync(
    payload: PayloadOf<typeof Events.FlightRescheduled>,
  ): Promise<void> {
    const { flightId, departureAt, arrivalAt } = payload;
    if (!Types.ObjectId.isValid(flightId)) return;
    const flight = new Types.ObjectId(flightId);
    // A booking is stale while its segment for this flight differs from the new times.
    const stale: QueryFilter<FlightBooking> = {
      status: { $in: ACTIVE },
      segments: {
        $elemMatch: {
          flightId: flight,
          $or: [
            { departureAt: { $ne: departureAt } },
            { arrivalAt: { $ne: arrivalAt } },
          ],
        },
      },
    };
    // Every booking looked at, so a failing one can't make the loop repeat.
    const seen: Types.ObjectId[] = [];
    for (;;) {
      const batch = await this.bookings
        .find({ ...stale, _id: { $nin: seen } }, { _id: 1 })
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .lean<{ _id: Types.ObjectId }[]>();
      for (const { _id } of batch) {
        seen.push(_id);
        await this.syncOne(_id, flight, payload, stale);
      }
      if (batch.length < BATCH_SIZE) return;
    }
  }

  /** One booking, in its own transaction; a failure is logged and left for a redelivery. */
  private async syncOne(
    bookingId: Types.ObjectId,
    flight: Types.ObjectId,
    { departureAt, arrivalAt }: PayloadOf<typeof Events.FlightRescheduled>,
    stale: QueryFilter<FlightBooking>,
  ): Promise<void> {
    let notify: { bookingId: string; userId: string } | undefined;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        notify = undefined; // the callback may run again after a transient error
        const changed = await this.bookings.updateOne(
          { ...stale, _id: bookingId },
          {
            $set: {
              'segments.$[moved].departureAt': departureAt,
              'segments.$[moved].arrivalAt': arrivalAt,
            },
          },
          { session, arrayFilters: [{ 'moved.flightId': flight }] },
        );
        // 0: another delivery synced it first, or it is no longer pending or confirmed.
        if (changed.modifiedCount !== 1) return;

        const booking = await this.bookings
          .findById(bookingId, {
            userId: 1,
            status: 1,
            'segments.departureAt': 1,
          })
          .session(session)
          .lean<SyncedBooking>();
        if (!booking) return;
        await this.bookings.updateOne(
          { _id: bookingId },
          {
            $set: {
              firstDepartureAt: booking.segments[0].departureAt,
              lastDepartureAt:
                booking.segments[booking.segments.length - 1].departureAt,
            },
          },
          { session },
        );
        // Only confirmed passengers are told; a pending booking has nothing to notify yet.
        if (booking.status === FlightBookingStatus.CONFIRMED) {
          notify = {
            bookingId: bookingId.toString(),
            userId: booking.userId.toString(),
          };
        }
      });
    } catch (error) {
      this.logger.error(
        `Could not sync flight booking ${bookingId.toString()}`,
        error instanceof Error ? error.stack : undefined,
      );
      return;
    } finally {
      await session.endSession();
    }

    // After the commit: an event can't be rolled back. The ID is made once per committed change.
    if (notify) {
      this.events.emit(Events.FlightBookingRescheduled, {
        eventId: randomUUID(),
        ...notify,
      });
    }
  }
}
