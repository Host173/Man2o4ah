import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AirlinesService } from './airlines.service.js';
import { FlightsService } from './flights.service.js';

describe('FlightsService (contract stub)', () => {
  let service: FlightsService;
  const airlineProfiles = {
    getAirline: vi.fn(),
    setAirlineActive: vi.fn(),
  };
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        FlightsService,
        { provide: AirlinesService, useValue: airlineProfiles },
      ],
    }).compile();
    service = moduleRef.get(FlightsService);
  });

  // Each method fails loudly until its ticket implements it, so nobody mistakes a stub for the real thing.
  it.each([
    ['getFlightsForBooking', () => service.getFlightsForBooking(['f1'])],
    ['checkBookable', () => service.checkBookable('f1', 'c1', 1)],
    ['search (one way)', () => service.search(search)],
    [
      'search (round trip)',
      () => service.search({ ...search, returnDate: '2026-11-27' }),
    ],
  ])('%s throws NotImplementedException', (_name, call) => {
    expect(call).toThrow(NotImplementedException);
  });

  it('delegates public airline operations to the profile service', async () => {
    airlineProfiles.getAirline.mockResolvedValue(null);
    airlineProfiles.setAirlineActive.mockResolvedValue({ id: 'a1' });

    await expect(service.getAirline('a1')).resolves.toBeNull();
    await expect(service.setAirlineActive('a1', false)).resolves.toMatchObject({
      id: 'a1',
    });
    expect(airlineProfiles.getAirline).toHaveBeenCalledWith('a1');
    expect(airlineProfiles.setAirlineActive).toHaveBeenCalledWith('a1', false);
  });
});
