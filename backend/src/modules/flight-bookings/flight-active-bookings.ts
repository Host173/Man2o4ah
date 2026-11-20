import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { BookingType } from '../../common/database/booking-type.js';
import type {
  ActiveBookingsCheck,
  ActiveBookingsCheckOptions,
} from '../accounts/ports/active-bookings-check.port.js';
import { ActiveBookingsCheckRegistry } from '../accounts/ports/active-bookings-check.registry.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

/** ACC-12: the booking owner's upcoming-confirmed flight check. */
@Injectable()
export class FlightActiveBookings implements ActiveBookingsCheck, OnModuleInit {
  readonly bookingType = BookingType.FLIGHT;

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly registry: ActiveBookingsCheckRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async hasUpcomingConfirmed(
    userId: string,
    options?: ActiveBookingsCheckOptions,
  ): Promise<boolean> {
    return Boolean(
      await this.bookings
        .exists({
          userId,
          status: FlightBookingStatus.CONFIRMED,
          firstDepartureAt: { $gt: new Date() },
        })
        .session(options?.session ?? null),
    );
  }
}
