import { NotImplementedException } from '@nestjs/common';
import { HotelBookingsService } from './hotel-bookings.service.js';

describe('hotel-bookings contract (stubs)', () => {
  const bookings = new HotelBookingsService();

  it('listForAdmin fails explicitly until ACC-11 implements it', () => {
    expect(() => bookings.listForAdmin({ page: 1, limit: 10 })).toThrow(
      NotImplementedException,
    );
  });
});
