import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events } from '../../common/events/events.js';
import type { EventName } from '../../common/events/events.js';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import {
  accountReactivated,
  accountSuspended,
  bookingCancelled,
  bookingConfirmed,
  flightBookingRescheduled,
  providerDeactivated,
  providerReactivated,
  refundUpdated,
} from './notification-content.js';
import type { NewNotification } from './notification-content.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Turns the events other modules emit into stored notifications (GEN-01).
 * A handler never throws to the emitter: a failure is logged and dropped.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(Events.FlightBookingConfirmed)
  async onFlightBookingConfirmed(
    payload: PayloadOf<typeof Events.FlightBookingConfirmed>,
  ): Promise<void> {
    await this.store(Events.FlightBookingConfirmed, () =>
      bookingConfirmed('flight', payload),
    );
  }

  @OnEvent(Events.FlightBookingCancelled)
  async onFlightBookingCancelled(
    payload: PayloadOf<typeof Events.FlightBookingCancelled>,
  ): Promise<void> {
    await this.store(Events.FlightBookingCancelled, () =>
      bookingCancelled('flight', payload),
    );
  }

  @OnEvent(Events.HotelReservationConfirmed)
  async onHotelReservationConfirmed(
    payload: PayloadOf<typeof Events.HotelReservationConfirmed>,
  ): Promise<void> {
    await this.store(Events.HotelReservationConfirmed, () =>
      bookingConfirmed('hotel', payload),
    );
  }

  @OnEvent(Events.HotelReservationCancelled)
  async onHotelReservationCancelled(
    payload: PayloadOf<typeof Events.HotelReservationCancelled>,
  ): Promise<void> {
    await this.store(Events.HotelReservationCancelled, () =>
      bookingCancelled('hotel', payload),
    );
  }

  @OnEvent(Events.RefundUpdated)
  async onRefundUpdated(
    payload: PayloadOf<typeof Events.RefundUpdated>,
  ): Promise<void> {
    await this.store(Events.RefundUpdated, () => refundUpdated(payload));
  }

  @OnEvent(Events.FlightBookingRescheduled)
  async onFlightBookingRescheduled(
    payload: PayloadOf<typeof Events.FlightBookingRescheduled>,
  ): Promise<void> {
    await this.store(Events.FlightBookingRescheduled, () =>
      flightBookingRescheduled(payload),
    );
  }

  @OnEvent(Events.AccountSuspended)
  async onAccountSuspended(
    payload: PayloadOf<typeof Events.AccountSuspended>,
  ): Promise<void> {
    await this.store(Events.AccountSuspended, () => accountSuspended(payload));
  }

  @OnEvent(Events.AccountReactivated)
  async onAccountReactivated(
    payload: PayloadOf<typeof Events.AccountReactivated>,
  ): Promise<void> {
    await this.store(Events.AccountReactivated, () =>
      accountReactivated(payload),
    );
  }

  @OnEvent(Events.ProviderDeactivated)
  async onProviderDeactivated(
    payload: PayloadOf<typeof Events.ProviderDeactivated>,
  ): Promise<void> {
    await this.store(Events.ProviderDeactivated, () =>
      providerDeactivated(payload),
    );
  }

  @OnEvent(Events.ProviderReactivated)
  async onProviderReactivated(
    payload: PayloadOf<typeof Events.ProviderReactivated>,
  ): Promise<void> {
    await this.store(Events.ProviderReactivated, () =>
      providerReactivated(payload),
    );
  }

  /** Builds the notifications and stores them; logs and swallows any failure. */
  private async store(
    event: EventName,
    build: () => NewNotification[],
  ): Promise<void> {
    try {
      await this.notifications.create(build());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to store notifications for ${event}: ${reason}`,
      );
    }
  }
}
