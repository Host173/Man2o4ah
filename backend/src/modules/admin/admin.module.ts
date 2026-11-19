import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module.js';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [AuditModule, FlightBookingsModule, HotelBookingsModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
