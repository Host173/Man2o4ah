import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsModule } from '../accounts/accounts.module.js';
import { HotelsModule } from '../hotels/hotels.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { HotelBookingsController } from './hotel-bookings.controller.js';
import { newReservationReference } from './booking-reference.js';
import { HotelBookingsService } from './hotel-bookings.service.js';
import {
  HotelConfirmationService,
  RESERVATION_REFERENCE,
} from './hotel-confirmation.service.js';
import { HotelHoldExpiryJob } from './hotel-hold-expiry.job.js';
import { HotelHoldService } from './hotel-hold.service.js';
import { HotelPayableBooking } from './hotel-payable-booking.js';
import { HotelModeratorController } from './hotel-moderator.controller.js';
import { HotelModeratorService } from './hotel-moderator.service.js';
import {
  HotelReservation,
  HotelReservationSchema,
} from './schemas/hotel-reservation.schema.js';
import { Review, ReviewSchema } from './schemas/review.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelReservation.name, schema: HotelReservationSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
    // hotel-bookings may call hotels (data-model 6.1).
    HotelsModule,
    AccountsModule,
    // Registers HotelPayableBooking with payments' registry (PAY-01).
    PaymentsModule,
  ],
  controllers: [HotelBookingsController, HotelModeratorController],
  providers: [
    HotelBookingsService,
    HotelModeratorService,
    HotelHoldService,
    HotelPayableBooking,
    HotelHoldExpiryJob,
    HotelConfirmationService,
    // The real reference maker; tests swap it to choose the references.
    { provide: RESERVATION_REFERENCE, useValue: newReservationReference },
  ],
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
