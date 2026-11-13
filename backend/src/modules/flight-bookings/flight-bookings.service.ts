import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  AdminFlightBookingQuery,
  FlightBookingAdminView,
} from './flight-bookings.types.js';

@Injectable()
export class FlightBookingsService {
  /** ACC-17: every flight booking for the admin list, newest `createdAt` first. Read-only. */
  listForAdmin(
    query: AdminFlightBookingQuery,
  ): Promise<Paginated<FlightBookingAdminView>> {
    void query;
    throw new NotImplementedException('listForAdmin: implemented in ACC-11');
  }
}
