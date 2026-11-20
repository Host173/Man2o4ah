import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  CancelledFlightBooking,
  FlightRefundPreview,
} from './flight-bookings.types.js';

/**
 * FLT-26: the owner cancels a confirmed booking before the outbound flight
 * departs. HTL-21's `HotelCancellationService` is the pattern to follow.
 */
@Injectable()
export class FlightCancellationService {
  /** Read-only: the refund the owner would get now, from the booking's snapshot tiers. */
  refundPreview(id: string, userId: string): Promise<FlightRefundPreview> {
    void id;
    void userId;
    throw new NotImplementedException('refundPreview: implemented in FLT-26');
  }

  /** Cancels the whole booking, returns its seats, then refunds and notifies. */
  cancel(id: string, userId: string): Promise<CancelledFlightBooking> {
    void id;
    void userId;
    throw new NotImplementedException('cancel: implemented in FLT-26');
  }
}
