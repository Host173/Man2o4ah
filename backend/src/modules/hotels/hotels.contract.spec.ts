import { NotImplementedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { StorageService } from '../storage/storage.service.js';
import { HotelsService } from './hotels.service.js';
import { RoomNightInventory } from './room-night-inventory.js';
import { Hotel } from './schemas/hotel.schema.js';
import { Room } from './schemas/room.schema.js';
import { RoomNight } from './schemas/room-night.schema.js';

describe('hotels contracts (stubs)', () => {
  let module: TestingModule;
  let hotels: HotelsService;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        HotelsService,
        { provide: getModelToken(Hotel.name), useValue: {} },
        { provide: getModelToken(Room.name), useValue: {} },
        { provide: getModelToken(RoomNight.name), useValue: {} },
        { provide: RoomNightInventory, useValue: {} },
        { provide: StorageService, useValue: {} },
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
    ['getRoomNights', () => hotels.getRoomNights('hotel-1', checkIn, checkOut)],
    [
      'search',
      () => hotels.search({ cityId: 'cairo', checkIn, checkOut, guests: 2 }),
    ],
  ];

  it.each(calls)(
    '%s fails explicitly until its feature is implemented',
    (_name, call) => {
      expect(call).toThrow(NotImplementedException);
    },
  );
});
