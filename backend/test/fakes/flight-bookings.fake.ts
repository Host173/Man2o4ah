import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import type { FlightBookingsService } from '../../src/modules/flight-bookings/flight-bookings.service.js';
import type {
  AdminFlightBookingQuery,
  FlightBookingAdminView,
} from '../../src/modules/flight-bookings/flight-bookings.types.js';
import type { PublicApi } from './public-api.js';

/** A working `FlightBookingsService` for other modules' tests: seeded bookings, kept in memory. */
export class FakeFlightBookingsService implements PublicApi<FlightBookingsService> {
  readonly bookings: FlightBookingAdminView[];

  constructor(bookings: FlightBookingAdminView[] = []) {
    // A deep copy, so a test that changes its fixtures can't affect another test.
    this.bookings = structuredClone(bookings);
  }

  listForAdmin(
    query: AdminFlightBookingQuery,
  ): Promise<Paginated<FlightBookingAdminView>> {
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
