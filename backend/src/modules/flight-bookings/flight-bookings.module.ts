import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsModule } from '../flights/flights.module.js';
import { FlightBookingsController } from './flight-bookings.controller.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import { FlightHoldService } from './flight-hold.service.js';
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
  ],
  controllers: [FlightBookingsController],
  providers: [FlightBookingsService, FlightQuoteService, FlightHoldService],
  exports: [FlightBookingsService],
})
export class FlightBookingsModule {}
