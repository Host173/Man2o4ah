import { NotImplementedException } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { SeatInventory } from './seat-inventory.js';

describe('SeatInventory (contract stub)', () => {
  const inventory = new SeatInventory();
  const items = [{ flightId: 'f1', cabinId: 'c1', seats: 1 }];
  const options = { session: {} as ClientSession };

  it.each([
    ['hold', () => inventory.hold(items, options)],
    ['confirm', () => inventory.confirm(items, options)],
    ['release', () => inventory.release(items, options)],
    ['returnBooked', () => inventory.returnBooked(items, options)],
    [
      'changeCapacity',
      () => inventory.changeCapacity('f1', 'c1', 8, 5, options),
    ],
  ])('%s throws NotImplementedException until INV-01', (_name, call) => {
    expect(call).toThrow(NotImplementedException);
  });
});
