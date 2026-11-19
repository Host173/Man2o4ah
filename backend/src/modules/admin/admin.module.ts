import { Module } from '@nestjs/common';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module.js';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [FlightBookingsModule, HotelBookingsModule, ModerationModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
