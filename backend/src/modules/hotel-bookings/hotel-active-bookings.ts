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
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

/** ACC-12: the booking owner's upcoming-confirmed reservation check. */
@Injectable()
export class HotelActiveBookings implements ActiveBookingsCheck, OnModuleInit {
  readonly bookingType = BookingType.HOTEL;

  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservation>,
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
      await this.reservations
        .exists({
          userId,
          status: HotelReservationStatus.CONFIRMED,
          checkInDate: { $gt: new Date() },
        })
        .session(options?.session ?? null),
    );
  }
}
