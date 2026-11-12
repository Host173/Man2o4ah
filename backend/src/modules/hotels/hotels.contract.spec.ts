import { NotImplementedException } from '@nestjs/common';
import { toDateOnly } from '../../common/dates/date-only.js';
import { HotelsService } from './hotels.service.js';
import { RoomNightInventory } from './room-night-inventory.js';

describe('hotels contracts (stubs)', () => {
  const hotels = new HotelsService();
  const inventory = new RoomNightInventory();
  const checkIn = toDateOnly('2026-11-15');
  const checkOut = toDateOnly('2026-11-17');
  const calls: [string, () => unknown][] = [
    ['getHotel', () => hotels.getHotel('hotel-1')],
    ['getRooms', () => hotels.getRooms('hotel-1')],
    ['getRoomNights', () => hotels.getRoomNights('hotel-1', checkIn, checkOut)],
    [
      'search',
      () => hotels.search({ cityId: 'cairo', checkIn, checkOut, guests: 2 }),
    ],
    [
      'setRatingSummary',
      () => hotels.setRatingSummary('hotel-1', { average: 4.5, count: 2 }),
    ],
    ['setActive', () => hotels.setActive('hotel-1', false)],
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
