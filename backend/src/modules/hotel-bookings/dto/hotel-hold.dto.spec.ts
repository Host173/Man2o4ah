import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ValidationError } from 'class-validator';
import { HotelHoldRequestDto } from './hotel-hold.dto.js';

const ROOM = '6553a1f0c2b4e8a9d0f1a301';

const valid = {
  hotelId: '6553a1f0c2b4e8a9d0f1a300',
  checkInDate: '2026-12-10',
  checkOutDate: '2026-12-13',
  rooms: [{ roomId: ROOM, adults: 2, childAges: [7] }],
};

/** Flattens nested errors into paths like `rooms.0.childAges`. */
function paths(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix + error.property;
    return error.children?.length ? paths(error.children, `${path}.`) : [path];
  });
}

/** Runs the same steps as the global ValidationPipe: transform, then validate. */
async function failed(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(HotelHoldRequestDto, body);
  return paths(
    await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
  );
}

const withRoom = (changes: Record<string, unknown>) => ({
  ...valid,
  rooms: [{ ...valid.rooms[0], ...changes }],
});

describe('HotelHoldRequestDto (HTL-16)', () => {
  it('accepts a valid body', async () => {
    expect(await failed(valid)).toEqual([]);
  });

  it('accepts a room with no children', async () => {
    expect(await failed(withRoom({ childAges: [] }))).toEqual([]);
  });

  it.each(['hotelId', 'checkInDate', 'checkOutDate', 'rooms'])(
    'requires %s',
    async (field) => {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      expect(await failed(body)).toContain(field);
    },
  );

  it('rejects an id that is not a Mongo id', async () => {
    expect(await failed({ ...valid, hotelId: 'hotel-1' })).toEqual(['hotelId']);
    expect(await failed(withRoom({ roomId: 'room-1' }))).toEqual([
      'rooms.0.roomId',
    ]);
  });

  it.each(['10-12-2026', '2026/12/10', '2026-12-1'])(
    'rejects the date %j',
    async (checkInDate) => {
      expect(await failed({ ...valid, checkInDate })).toEqual(['checkInDate']);
    },
  );

  it('requires at least one room', async () => {
    expect(await failed({ ...valid, rooms: [] })).toEqual(['rooms']);
  });

  describe('adults', () => {
    it.each([
      [0, []], // a children-only room (another room must have an adult)
      [1, []],
      [-1, ['rooms.0.adults']],
      [1.5, ['rooms.0.adults']],
    ])('%d → errors %j', async (adults, expected) => {
      expect(await failed(withRoom({ adults }))).toEqual(expected);
    });
  });

  // Every age is checked ({ each: true }), not the array itself.
  describe('childAges (0-17)', () => {
    it.each([
      [[0], []],
      [[17], []],
      [[5, 17, 0], []],
      [[18], ['rooms.0.childAges']],
      [[5, 18], ['rooms.0.childAges']],
      [[-1], ['rooms.0.childAges']],
      [[2.5], ['rooms.0.childAges']],
    ])('%j → errors %j', async (childAges, expected) => {
      expect(await failed(withRoom({ childAges }))).toEqual(expected);
    });

    it('requires a list', async () => {
      expect(await failed(withRoom({ childAges: 5 }))).toEqual([
        'rooms.0.childAges',
      ]);
    });
  });

  it('rejects fields the client must not send (GEN-13)', async () => {
    expect(await failed({ ...valid, totalMinor: 1, userId: ROOM })).toEqual([
      'totalMinor',
      'userId',
    ]);
  });
});
