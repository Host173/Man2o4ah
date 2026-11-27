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
import { FlightBooking } from './schemas/flight-booking.schema.js';

/**
 * Flight bookings as payments sees them (PAY-01, PAY-02). Payments owns the
 * port and never imports this module: this class registers itself at startup.
 * Only the owner can read a booking; anyone else gets 404, as if it didn't
 * exist (ACC-11).
 */
@Injectable()
export class FlightPayableBooking implements PayableBooking, OnModuleInit {
  readonly bookingType = BookingType.FLIGHT;

  constructor(
    private readonly registry: PayableBookingRegistry,
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async getPayable(
    bookingId: string,
    userId: string,
    changeId?: string,
  ): Promise<Payable> {
    const booking = await this.findOwned(bookingId, userId);
    if (changeId !== undefined) {
      // FLT-27: only the change waiting for payment on a confirmed booking.
      const pending = booking.pendingChange;
      if (
        booking.status !== 'confirmed' ||
        !pending ||
        pending._id.toString() !== changeId
      ) {
        throw notFound();
      }
      return {
        amountMinor: pending.differenceMinor,
        currency: pending.pricing.currency,
        status: 'pending_payment',
        holdExpiresAt: pending.holdExpiresAt,
      };
    }
    return {
      amountMinor: booking.pricing.totalMinor,
      currency: booking.pricing.currency,
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt,
    };
  }

  async getPolicies(
    bookingId: string,
    userId: string,
  ): Promise<BookingPolicies> {
    const booking = await this.findOwned(bookingId, userId);
    return {
      bookingType: BookingType.FLIGHT,
      segments: booking.segments.map((segment) => ({
        direction: segment.direction,
        flightNumber: segment.flightNumber,
        cancellationTiers: segment.policy.cancellationTiers.map((tier) => ({
          daysBefore: tier.daysBefore,
          refundPercent: tier.refundPercent,
        })),
        freeBags: segment.policy.freeBags,
        maxBagWeightKg: segment.policy.maxBagWeightKg,
        extraBagPriceMinor: segment.policy.extraBagPriceMinor,
        maxExtraBagsPerPassenger: segment.policy.maxExtraBagsPerPassenger,
      })),
    };
  }

  /** The booking if `userId` owns it; otherwise 404 (also for malformed ids). */
  private async findOwned(
    bookingId: string,
    userId: string,
  ): Promise<FlightBooking> {
    if (!Types.ObjectId.isValid(bookingId) || !Types.ObjectId.isValid(userId)) {
      throw notFound();
    }
    // Owner and id in one query: there's no "found, but not yours" branch.
    const booking = await this.bookingModel
      .findOne({ _id: bookingId, userId })
      .lean();
    if (!booking) throw notFound();
    return booking;
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'Booking not found',
  });
}
