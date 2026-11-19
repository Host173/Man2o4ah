import { toDateOnly } from '../../common/dates/date-only.js';
import { checkStay } from './stay-rules.js';
import type {
  RequestedRoom,
  RuleHotel,
  RuleRoom,
  StayRequest,
} from './stay-rules.js';

const today = toDateOnly('2026-11-17');

const hotel: RuleHotel = { isActive: true };
const hotelRooms: RuleRoom[] = [
  { id: 'room-101', isActive: true, maxOccupancy: 2 },
  { id: 'room-102', isActive: true, maxOccupancy: 4 },
  { id: 'room-closed', isActive: false, maxOccupancy: 2 },
];

const room = (changes: Partial<RequestedRoom> = {}): RequestedRoom => ({
  roomId: 'room-101',
  adults: 1,
  childAges: [],
  ...changes,
});

const stay = (changes: Partial<StayRequest> = {}): StayRequest => ({
  checkInDate: toDateOnly('2026-12-10'),
  checkOutDate: toDateOnly('2026-12-13'),
  rooms: [room()],
  ...changes,
});

/** Only the `field`s, so a test reads as "which inputs are wrong". */
const fieldsOf = (request: StayRequest, theHotel: RuleHotel | null = hotel) =>
  checkStay(request, theHotel, hotelRooms, today).map((e) => e.field);

describe('checkStay (HTL-16, HTL-18)', () => {
  it('accepts a valid stay in two rooms', () => {
    expect(
      fieldsOf(
        stay({
          rooms: [
            room({ adults: 2 }),
            room({ roomId: 'room-102', adults: 1, childAges: [5, 9] }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  describe('dates', () => {
    it.each([
      ['today', '2026-11-17', []],
      ['yesterday', '2026-11-16', ['checkInDate']],
    ])('check-in %s → errors %j', (_label, checkIn, expected) => {
      const request = stay({
        checkInDate: toDateOnly(checkIn),
        checkOutDate: toDateOnly('2026-11-20'),
      });
      expect(fieldsOf(request)).toEqual(expected);
    });

    it.each([
      ['the next day (1 night)', '2026-12-11', []],
      ['the same day', '2026-12-10', ['checkOutDate']],
      ['the day before', '2026-12-09', ['checkOutDate']],
    ])('check-out %s → errors %j', (_label, checkOut, expected) => {
      expect(fieldsOf(stay({ checkOutDate: toDateOnly(checkOut) }))).toEqual(
        expected,
      );
    });

    it('skips the date rules for a date that does not exist (the service reports it)', () => {
      expect(fieldsOf(stay({ checkInDate: undefined }))).toEqual([]);
    });
  });

  describe('hotel', () => {
    it('rejects a hotel that does not exist, and checks nothing else', () => {
      expect(fieldsOf(stay(), null)).toEqual(['hotelId']);
    });

    it('rejects an inactive hotel (ACC-15)', () => {
      expect(fieldsOf(stay(), { isActive: false })).toEqual(['hotelId']);
    });
  });

  describe('rooms', () => {
    it('rejects a room that is not in this hotel', () => {
      expect(
        fieldsOf(stay({ rooms: [room({ roomId: 'room-of-another-hotel' })] })),
      ).toEqual(['rooms[0].roomId']);
    });

    it('rejects an inactive room (HTL-06)', () => {
      expect(
        fieldsOf(stay({ rooms: [room({ roomId: 'room-closed' })] })),
      ).toEqual(['rooms[0].roomId']);
    });

    it('rejects the same room twice', () => {
      expect(fieldsOf(stay({ rooms: [room(), room()] }))).toEqual([
        'rooms[1].roomId',
      ]);
    });
  });

  describe('guests', () => {
    it('requires at least one adult in the whole reservation', () => {
      const childrenOnly = room({ adults: 0, childAges: [10] });
      expect(fieldsOf(stay({ rooms: [childrenOnly] }))).toEqual(['rooms']);
    });

    it('allows a room with only children when another room has an adult', () => {
      expect(
        fieldsOf(
          stay({
            rooms: [
              room({ adults: 1 }),
              room({ roomId: 'room-102', adults: 0, childAges: [10, 12] }),
            ],
          }),
        ),
      ).toEqual([]);
    });

    it('requires at least one guest in every room', () => {
      const empty = room({ roomId: 'room-102', adults: 0, childAges: [] });
      expect(fieldsOf(stay({ rooms: [room(), empty] }))).toEqual(['rooms[1]']);
    });

    // room-101 sleeps 2: exactly 2 is fine, 3 is one too many.
    it.each([
      ['2 adults', { adults: 2, childAges: [] }, []],
      ['1 adult + 1 child', { adults: 1, childAges: [4] }, []],
      ['2 adults + 1 child', { adults: 2, childAges: [4] }, ['rooms[0]']],
      ['3 adults', { adults: 3, childAges: [] }, ['rooms[0]']],
    ])('%s in a room for 2 → errors %j', (_label, guests, expected) => {
      expect(fieldsOf(stay({ rooms: [room(guests)] }))).toEqual(expected);
    });
  });

  it('reports every broken rule at once, each with a message', () => {
    const errors = checkStay(
      stay({
        checkInDate: toDateOnly('2026-11-16'), // yesterday
        checkOutDate: toDateOnly('2026-11-16'), // not after check-in
        rooms: [
          room({ adults: 0, childAges: [3, 4, 5] }), // no adult; over capacity
          room({ roomId: 'room-closed' }), // inactive (its adult counts)
        ],
      }),
      hotel,
      hotelRooms,
      today,
    );
    expect(errors.map((e) => e.field)).toEqual([
      'checkInDate',
      'checkOutDate',
      'rooms[0]',
      'rooms[1].roomId',
    ]);
    for (const error of errors) {
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});
