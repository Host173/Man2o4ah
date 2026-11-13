import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import type { HotelBookingsService } from '../../src/modules/hotel-bookings/hotel-bookings.service.js';
import type {
  AdminHotelReservationQuery,
  HotelReservationAdminView,
} from '../../src/modules/hotel-bookings/hotel-bookings.types.js';
import type { PublicApi } from './public-api.js';

/** A working `HotelBookingsService` for other modules' tests: seeded reservations, kept in memory. */
export class FakeHotelBookingsService implements PublicApi<HotelBookingsService> {
  readonly bookings: HotelReservationAdminView[];

  constructor(bookings: HotelReservationAdminView[] = []) {
    // A deep copy, so a test that changes its fixtures can't affect another test.
    this.bookings = structuredClone(bookings);
  }

  listForAdmin(
    query: AdminHotelReservationQuery,
  ): Promise<Paginated<HotelReservationAdminView>> {
    const { status, from, to, page, limit } = query;
    const matching = this.bookings
      .filter((booking) => status === undefined || booking.status === status)
      .filter((booking) => from === undefined || booking.createdAt >= from)
      .filter((booking) => to === undefined || booking.createdAt <= to)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const items = matching.slice((page - 1) * limit, page * limit);
    return Promise.resolve(
      toPage(structuredClone(items), matching.length, page, limit),
    );
  }
}
