import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
  ],
})
export class FlightBookingsModule {}
