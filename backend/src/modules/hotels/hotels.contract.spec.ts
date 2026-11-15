import { NotImplementedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { HotelsService } from './hotels.service.js';
import { RoomNightInventory } from './room-night-inventory.js';
import { Hotel } from './schemas/hotel.schema.js';

describe('hotels contracts (stubs)', () => {
  let module: TestingModule;
  let hotels: HotelsService;
  const inventory = new RoomNightInventory();
  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        HotelsService,
        { provide: getModelToken(Hotel.name), useValue: {} },
        {
          provide: ReferenceDataService,
          useValue: new FakeReferenceDataService(),
        },
      ],
    }).compile();
    hotels = module.get(HotelsService);
  });
  afterAll(() => module.close());
  const checkIn = toDateOnly('2026-11-15');
  const checkOut = toDateOnly('2026-11-17');
  const calls: [string, () => unknown][] = [
    ['getRooms', () => hotels.getRooms('hotel-1')],
    ['getRoomNights', () => hotels.getRoomNights('hotel-1', checkIn, checkOut)],
    [
      'search',
      () => hotels.search({ cityId: 'cairo', checkIn, checkOut, guests: 2 }),
    ],
    [
      'reserve',
      () =>
        inventory.reserve(
          'hotel-1',
          ['room-1'],
          checkIn,
          checkOut,
          'reservation-1',
        ),
    ],
    ['release', () => inventory.release('reservation-1')],
    ['block', () => inventory.block('room-1', checkIn, checkOut)],
    ['unblock', () => inventory.unblock('block-1')],
    [
      'setAvailability',
      () =>
        inventory.setAvailability('room-1', [
          { fromDate: checkIn, toDate: checkOut },
        ]),
    ],
    ['deactivate', () => inventory.deactivate('room-1')],
    ['delete', () => inventory.delete('room-1')],
  ];

  it.each(calls)(
    '%s fails explicitly until its feature is implemented',
    (_name, call) => {
      expect(call).toThrow(NotImplementedException);
    },
  );
});
