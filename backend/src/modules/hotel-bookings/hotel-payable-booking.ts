import { Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type {
  BookingPolicies,
  Payable,
  PayableBooking,
} from '../payments/ports/payable-booking.port.js';
import { PayableBookingRegistry } from '../payments/ports/payable-booking.registry.js';
import { HotelReservation } from './schemas/hotel-reservation.schema.js';

/**
 * Hotel reservations as payments sees them (PAY-01, PAY-02). Payments owns the
 * port and never imports this module: this class registers itself at startup.
 * Only the owner can read a reservation; anyone else gets 404, as if it didn't
 * exist (ACC-11).
 */
@Injectable()
export class HotelPayableBooking implements PayableBooking, OnModuleInit {
  readonly bookingType = BookingType.HOTEL;

  constructor(
    private readonly registry: PayableBookingRegistry,
    @InjectModel(HotelReservation.name)
    private readonly reservationModel: Model<HotelReservation>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async getPayable(bookingId: string, userId: string): Promise<Payable> {
    const reservation = await this.findOwned(bookingId, userId);
    return {
      amountMinor: reservation.totalMinor,
      currency: reservation.currency,
      status: reservation.status,
      holdExpiresAt: reservation.holdExpiresAt,
    };
  }

  /** The policy copied at hold time, never the hotel's current one (PAY-02). */
  async getPolicies(
    bookingId: string,
    userId: string,
  ): Promise<BookingPolicies> {
    const { policySnapshot } = await this.findOwned(bookingId, userId);
    return {
      bookingType: BookingType.HOTEL,
      cancellationTiers: policySnapshot.cancellationTiers.map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      })),
      checkInTime: policySnapshot.checkInTime,
      checkOutTime: policySnapshot.checkOutTime,
    };
  }

  /** The reservation if `userId` owns it; otherwise 404 (also for malformed ids). */
  private async findOwned(
    bookingId: string,
    userId: string,
  ): Promise<HotelReservation> {
    if (!Types.ObjectId.isValid(bookingId) || !Types.ObjectId.isValid(userId)) {
      throw notFound();
    }
    // Owner and id in one query: there's no "found, but not yours" branch.
    const reservation = await this.reservationModel
      .findOne({ _id: bookingId, userId })
      .lean();
    if (!reservation) throw notFound();
    return reservation;
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'Reservation not found',
  });
}
