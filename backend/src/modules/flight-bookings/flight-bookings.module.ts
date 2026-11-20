import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsModule } from '../flights/flights.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { FlightBookingsController } from './flight-bookings.controller.js';
import { newBookingReference } from './booking-reference.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import {
  BOOKING_REFERENCE,
  FlightConfirmationService,
} from './flight-confirmation.service.js';
import { FlightHoldExpiryJob } from './flight-hold-expiry.job.js';
import { FlightHoldService } from './flight-hold.service.js';
import { FlightPayableBooking } from './flight-payable-booking.js';
import { FlightQuoteService } from './flight-quote.service.js';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
    // flight-bookings may call flights (data-model 6.1).
    FlightsModule,
    // Registers FlightPayableBooking with payments' registry (PAY-01).
    PaymentsModule,
  ],
  controllers: [FlightBookingsController],
  providers: [
    FlightBookingsService,
    FlightQuoteService,
    FlightHoldService,
    FlightPayableBooking,
    FlightHoldExpiryJob,
    FlightConfirmationService,
    // The real reference maker; tests swap it to choose the references.
    { provide: BOOKING_REFERENCE, useValue: newBookingReference },
  ],
  exports: [FlightBookingsService],
})
export class FlightBookingsModule {}
