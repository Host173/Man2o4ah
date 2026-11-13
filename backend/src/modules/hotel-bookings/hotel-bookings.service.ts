import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  AdminHotelReservationQuery,
  HotelReservationAdminView,
} from './hotel-bookings.types.js';

@Injectable()
export class HotelBookingsService {
  /** ACC-17: every hotel reservation for the admin list, newest `createdAt` first. Read-only. */
  listForAdmin(
    query: AdminHotelReservationQuery,
  ): Promise<Paginated<HotelReservationAdminView>> {
    void query;
    throw new NotImplementedException('listForAdmin: implemented in ACC-11');
  }
}
