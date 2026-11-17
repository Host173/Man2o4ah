import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsModule } from '../hotels/hotels.module.js';
import { HotelBookingsService } from './hotel-bookings.service.js';
import { HotelHoldService } from './hotel-hold.service.js';
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
  ],
  providers: [HotelBookingsService, HotelHoldService],
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
