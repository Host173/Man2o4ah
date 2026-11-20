import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module.js';
import { FlightsModule } from '../flights/flights.module.js';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module.js';
import { HotelsModule } from '../hotels/hotels.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [
    AccountsModule,
    AuditModule,
    FlightsModule,
    HotelsModule,
    FlightBookingsModule,
    HotelBookingsModule,
    ModerationModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
