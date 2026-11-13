import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  HotelReservation,
  HotelReservationSchema,
} from './schemas/hotel-reservation.schema.js';
import { Review, ReviewSchema } from './schemas/review.schema.js';
import { HotelBookingsService } from './hotel-bookings.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelReservation.name, schema: HotelReservationSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
  ],
  providers: [HotelBookingsService],
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
