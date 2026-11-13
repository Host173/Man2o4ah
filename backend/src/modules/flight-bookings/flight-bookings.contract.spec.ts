import { NotImplementedException } from '@nestjs/common';
import { FlightBookingsService } from './flight-bookings.service.js';

describe('flight-bookings contract (stubs)', () => {
  const bookings = new FlightBookingsService();

  it('listForAdmin fails explicitly until ACC-11 implements it', () => {
    expect(() => bookings.listForAdmin({ page: 1, limit: 10 })).toThrow(
      NotImplementedException,
    );
  });
});
