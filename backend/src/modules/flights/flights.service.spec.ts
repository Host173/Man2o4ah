import { NotImplementedException } from '@nestjs/common';
import { FlightsService } from './flights.service.js';

describe('FlightsService (contract stub)', () => {
  const service = new FlightsService();
  const search = {
    from: 'CAI',
    to: 'DXB',
    date: '2026-11-20',
    adults: 1,
    children: 0,
    infants: 0,
    sortBy: 'price' as const,
    page: 1,
    limit: 10,
  };

  // Each method fails loudly until its ticket implements it, so nobody mistakes a stub for the real thing.
  it.each([
    ['getFlightsForBooking', () => service.getFlightsForBooking(['f1'])],
    ['checkBookable', () => service.checkBookable('f1', 'c1', 1)],
    ['search (one way)', () => service.search(search)],
    [
      'search (round trip)',
      () => service.search({ ...search, returnDate: '2026-11-27' }),
    ],
    ['getAirline', () => service.getAirline('a1')],
    ['setAirlineActive', () => service.setAirlineActive('a1', false)],
  ])('%s throws NotImplementedException', (_name, call) => {
    expect(call).toThrow(NotImplementedException);
  });
});
