import { Types } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { PayableBookingRegistry } from '../payments/ports/payable-booking.registry.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelHoldService } from './hotel-hold.service.js';
import { HotelPayableBooking } from './hotel-payable-booking.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1a501';
const ROOM = '6553a1f0c2b4e8a9d0f1a502';
const OWNER = '6553a1f0c2b4e8a9d0f1a598';
const SOMEONE_ELSE = '6553a1f0c2b4e8a9d0f1a599';

function seededHotels(): FakeHotelsService {
  return new FakeHotelsService({
    hotels: [
      {
        id: HOTEL,
        name: 'Nile View',
        address: '1 Corniche',
        cityId: 'cairo',
        countryCode: 'EG',
        photos: [],
        amenities: [],
        checkInTime: '15:00',
        checkOutTime: '11:00',
        cancellationPolicy: {
          tiers: [
            { daysBefore: 3, refundPercent: 50 },
            { daysBefore: 14, refundPercent: 100 },
          ],
        },
        isActive: true,
        ratingSummary: { average: null, count: 0 },
      },
    ],
    rooms: [
      {
        id: ROOM,
        hotelId: HOTEL,
        name: '101',
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10_000,
        isActive: true,
        availability: [
          {
            fromDate: toDateOnly('2027-01-01'),
            toDate: toDateOnly('2027-12-31'),
          },
        ],
        hasEverBeenReserved: false,
      },
    ],
    roomNights: [],
  });
}

const stay = {
  hotelId: HOTEL,
  checkInDate: '2027-03-10',
  checkOutDate: '2027-03-12',
  rooms: [{ roomId: ROOM, adults: 2, childAges: [] }],
};

const NOT_FOUND = { status: 404, response: { code: 'NOT_FOUND' } };

describe('HotelPayableBooking (PAY-01, PAY-02, ACC-11)', () => {
  let t: TestApp;
  let holds: HotelHoldService;
  let payable: HotelPayableBooking;
  const hotels = new FakeHotelsService();
  const inventory = new FakeRoomNightInventory(hotels);

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(HotelsService)
          .useValue(hotels)
          .overrideProvider(RoomNightInventory)
          .useValue(inventory),
    });
    holds = t.moduleRef.get(HotelHoldService);
    payable = t.moduleRef.get(HotelPayableBooking);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    Object.assign(hotels, seededHotels());
    await clearCollections(t.connection);
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('registers itself as the hotel PayableBooking at startup', () => {
    const registry = t.moduleRef.get(PayableBookingRegistry);
    expect(registry.get('hotel')).toBe(payable);
    expect(payable.bookingType).toBe('hotel');
  });

  it('returns the amount, currency, status and hold expiry to the owner', async () => {
    const hold = await holds.hold(stay, OWNER);

    await expect(
      payable.getPayable(hold.reservationId, OWNER),
    ).resolves.toEqual({
      amountMinor: 20_000, // 2 nights × 100.00
      currency: 'USD',
      status: 'pending_payment',
      holdExpiresAt: hold.holdExpiresAt,
    });
  });

  it('returns the hotel’s policy snapshot to the owner', async () => {
    const hold = await holds.hold(stay, OWNER);

    await expect(
      payable.getPolicies(hold.reservationId, OWNER),
    ).resolves.toEqual({
      bookingType: 'hotel',
      cancellationTiers: [
        { daysBefore: 3, refundPercent: 50 },
        { daysBefore: 14, refundPercent: 100 },
      ],
      checkInTime: '15:00',
      checkOutTime: '11:00',
    });
  });

  it('keeps the snapshot when the hotel changes its policy later', async () => {
    const hold = await holds.hold(stay, OWNER);
    hotels.data.hotels[0].cancellationPolicy = { tiers: [] };
    hotels.data.hotels[0].checkInTime = '16:00';

    const policies = await payable.getPolicies(hold.reservationId, OWNER);
    expect(policies).toMatchObject({ checkInTime: '15:00' });
  });

  // ACC-11: someone else's reservation looks exactly like one that doesn't exist.
  describe.each(['getPayable', 'getPolicies'] as const)('%s', (method) => {
    it('answers 404 for another user’s reservation', async () => {
      const hold = await holds.hold(stay, OWNER);
      await expect(
        payable[method](hold.reservationId, SOMEONE_ELSE),
      ).rejects.toMatchObject(NOT_FOUND);
    });

    it('answers 404 for an unknown reservation', async () => {
      await expect(
        payable[method](new Types.ObjectId().toHexString(), OWNER),
      ).rejects.toMatchObject(NOT_FOUND);
    });

    it('answers 404, not 500, for a malformed id', async () => {
      await expect(payable[method]('not-an-id', OWNER)).rejects.toMatchObject(
        NOT_FOUND,
      );
    });
  });
});
