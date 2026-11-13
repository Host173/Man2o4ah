import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema.js';
import { FlightBookingsService } from './flight-bookings.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
  ],
  providers: [FlightBookingsService],
  exports: [FlightBookingsService],
})
export class FlightBookingsModule {}
