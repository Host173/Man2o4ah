import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import {
  addDays,
  daysBetween,
  toDateOnly,
} from '../../common/dates/date-only.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { Room } from '../hotels/schemas/room.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

const day = (date: Date) => date.toISOString().slice(0, 10);
const REFERENCE = 'HRABC234';

// The moderator API spec uses FakeHotelsService; this one runs the real inventory read.
describe('room status view over the real hotels service (HTL-08)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService()),
    });
  }, HOOK_TIMEOUT);
  beforeEach(() => clearCollections(t.connection));
  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('answers 200 with available, booked (with reference) and blocked nights', async () => {
    const hotels = t.moduleRef.get(HotelsService);
    const inventory = t.moduleRef.get(RoomNightInventory);
    const rooms = t.moduleRef.get<Model<Room>>(getModelToken(Room.name));
    const reservations = t.moduleRef.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
    const today = toDateOnly(day(new Date()));
    const checkIn = addDays(today, 2);
    const checkOut = addDays(today, 4);
    const hotelId = (
      await hotels.create({
        name: 'Nile View Hotel',
        address: '1 Corniche El Nil',
        cityId: 'cairo',
        description: 'A hotel by the Nile',
        starRating: 4,
        amenities: ['Wi-Fi', 'Pool'],
      })
    ).id;
    const room = await rooms.create({
      hotelId,
      name: '101',
      type: 'Double',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightMinor: 10_000,
      availability: [{ fromDate: today, toDate: addDays(today, 30) }],
    });
    const roomId = room._id.toHexString();
    const nights = daysBetween(checkIn, checkOut);
    const reservation = await reservations.create({
      userId: new Types.ObjectId(),
      hotelId: new Types.ObjectId(hotelId),
      status: HotelReservationStatus.CONFIRMED,
      reference: REFERENCE,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      nights,
      rooms: [
        {
          roomId: room._id,
          roomName: '101',
          roomType: 'Double',
          pricePerNightMinor: 10_000,
          adults: 1,
          childAges: [],
          subtotalMinor: nights * 10_000,
        },
      ],
      totalMinor: nights * 10_000,
      currency: 'USD',
      policySnapshot: {
        cancellationTiers: [],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      holdExpiresAt: new Date(Date.now() + 600_000),
    });
    await t.connection.transaction((session) =>
      inventory.reserve(hotelId, [roomId], checkIn, checkOut, reservation.id, {
        session,
      }),
    );
    await hotels.manageRoomBlock(
      hotelId,
      roomId,
      { op: 'BLOCK' as const, fromDate: day(checkOut), toDate: day(checkOut) },
      hotelId,
    );
    const moderator = await loginAs(t.connection, UserRole.HOTEL_MODERATOR, {
      providerId: hotelId,
    });

    const res = await t
      .http()
      .get(`/api/hotels/${hotelId}/availability`)
      .query({ from: day(addDays(today, 1)), to: day(addDays(today, 5)) })
      .set('Cookie', moderator.cookie);

    expect(res.status).toBe(200);
    const booked = {
      status: 'booked',
      reservationId: reservation.id,
      reference: REFERENCE,
    };
    expect(res.body.items).toEqual([
      {
        _id: roomId,
        name: '101',
        type: 'Double',
        isActive: true,
        nights: [
          { date: day(addDays(today, 1)), status: 'available' },
          { date: day(checkIn), ...booked },
          { date: day(addDays(today, 3)), ...booked },
          { date: day(checkOut), status: 'blocked', reason: 'blocked_range' },
          { date: day(addDays(today, 5)), status: 'available' },
        ],
      },
    ]);
  });
});
