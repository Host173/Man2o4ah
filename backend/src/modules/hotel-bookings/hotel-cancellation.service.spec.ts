import { ConflictException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelCancellationService } from './hotel-cancellation.service.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

const USER = new Types.ObjectId().toHexString();
const HOTEL = new Types.ObjectId().toHexString();
const ROOMS = [
  new Types.ObjectId().toHexString(),
  new Types.ObjectId().toHexString(),
];

describe('HotelCancellationService (HTL-21)', () => {
  let t: TestApp;
  let service: HotelCancellationService;
  let reservations: Model<HotelReservation>;
  const hotels = new FakeHotelsService();
  const inventory = new FakeRoomNightInventory(hotels);
  const payments = new FakePaymentsService();
  const events = new FakeEvents();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (b) =>
        b
          .overrideProvider(RoomNightInventory)
          .useValue(inventory)
          .overrideProvider(PaymentsService)
          .useValue(payments)
          .overrideProvider(AppEvents)
          .useValue(events),
    });
    service = t.moduleRef.get(HotelCancellationService);
    reservations = t.moduleRef.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    hotels.data.roomNights.length = 0;
    payments.refunds.length = 0;
    events.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-07T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function seed(changes: Partial<HotelReservation> = {}) {
    const reservation = await reservations.create({
      userId: USER,
      hotelId: HOTEL,
      reference: 'HRABCDEFG'.slice(0, 8),
      status: HotelReservationStatus.CONFIRMED,
      checkInDate: toDateOnly('2027-03-10'),
      checkOutDate: toDateOnly('2027-03-12'),
      nights: 2,
      totalMinor: 12_346,
      currency: 'USD',
      rooms: ROOMS.map((roomId, i) => ({
        roomId,
        roomName: String(i),
        roomType: 'Double',
        pricePerNightMinor: i ? 3673 : 2500,
        adults: 1,
        childAges: [],
        subtotalMinor: i ? 7346 : 5000,
      })),
      policySnapshot: {
        cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
        checkInTime: '15:00',
        checkOutTime: '11:00',
      },
      holdExpiresAt: new Date('2027-03-01T00:10:00Z'),
      confirmedAt: new Date('2027-03-01T00:05:00Z'),
      ...changes,
    });
    for (const roomId of ROOMS) {
      for (const date of ['2027-03-10', '2027-03-11']) {
        hotels.data.roomNights.push({
          hotelId: HOTEL,
          roomId,
          date: toDateOnly(date),
          kind: 'reservation',
          reservationId: reservation.id,
        });
      }
    }
    return reservation;
  }

  it('previews the snapshot refund on the full total without writing or calling payments', async () => {
    const reservation = await seed();
    expect(await service.refundPreview(reservation.id, USER)).toEqual({
      percent: 50,
      amountMinor: 6173,
      currency: 'USD',
    });
    expect((await reservations.findById(reservation.id).lean())?.status).toBe(
      'confirmed',
    );
    expect(hotels.data.roomNights).toHaveLength(4);
    expect(payments.refunds).toHaveLength(0);
    expect(events.emitted).toHaveLength(0);
  });

  it('cancels every room, preserves unrelated nights, and refunds after commit', async () => {
    const reservation = await seed();
    const unrelated = new Types.ObjectId().toHexString();
    hotels.data.roomNights.push({
      hotelId: HOTEL,
      roomId: ROOMS[0],
      date: toDateOnly('2027-03-12'),
      kind: 'reservation',
      reservationId: unrelated,
    });
    const release = vi.spyOn(inventory, 'release');
    const refund = vi
      .spyOn(payments, 'refund')
      .mockImplementation(async (request) => {
        expect(
          (await reservations.findById(reservation.id).lean())?.status,
        ).toBe('cancelled');
        expect(hotels.data.roomNights.map((n) => n.reservationId)).toEqual([
          unrelated,
        ]);
        return FakePaymentsService.prototype.refund.call(payments, request);
      });

    const result = await service.cancel(reservation.id, USER);

    expect(result).toMatchObject({
      _id: reservation.id,
      reference: reservation.reference,
      status: 'cancelled',
      cancellation: {
        cancelledAt: new Date(),
        cancelledBy: 'user',
        refundPercent: 50,
        refundAmountMinor: 6173,
      },
      refund: { status: 'pending', amountMinor: 6173, currency: 'USD' },
    });
    expect(
      (await reservations.findById(reservation.id).lean())?.cancellation,
    ).toEqual(result.cancellation);
    const session = release.mock.calls[0][1]?.session;
    expect(session).toBeDefined();
    expect(session?.hasEnded).toBe(true);
    expect(refund).toHaveBeenCalledWith({
      bookingType: BookingType.HOTEL,
      bookingId: reservation.id,
      userId: USER,
      amountMinor: 6173,
      currency: 'USD',
      reason: 'user_cancel',
    });
    expect(events.payloadsOf(Events.HotelReservationCancelled)).toEqual([
      {
        bookingId: reservation.id,
        userId: USER,
        reference: reservation.reference,
      },
    ]);
  });

  it('recalculates the preview at confirmation time when a refund boundary passes', async () => {
    const reservation = await seed();
    expect((await service.refundPreview(reservation.id, USER)).percent).toBe(
      50,
    );
    vi.setSystemTime(new Date('2027-03-07T00:00:00.001Z'));
    expect(
      (await service.cancel(reservation.id, USER)).cancellation.refundPercent,
    ).toBe(0);
    expect(payments.refunds).toHaveLength(0);
  });

  it.each([0, 1])(
    'does not call payments for a zero amount (total=%i)',
    async (totalMinor) => {
      const reservation = await seed({
        totalMinor,
        policySnapshot: {
          cancellationTiers: [{ daysBefore: 0, refundPercent: 0 }],
          checkInTime: '15:00',
          checkOutTime: '11:00',
        },
      });
      const refund = vi.spyOn(payments, 'refund');
      expect((await service.cancel(reservation.id, USER)).refund).toBeNull();
      expect(refund).not.toHaveBeenCalled();
      expect(hotels.data.roomNights).toHaveLength(0);
    },
  );

  it.each(['pending_payment', 'completed', 'expired', 'cancelled'] as const)(
    'rejects %s for both operations without side effects',
    async (status) => {
      const reservation = await seed({ status });
      for (const action of ['refundPreview', 'cancel'] as const) {
        await expect(
          service[action](reservation.id, USER),
        ).rejects.toMatchObject({
          status: 409,
          response: { code: ErrorCode.InvalidStatusTransition },
        });
      }
      expect(hotels.data.roomNights).toHaveLength(4);
      expect(payments.refunds).toHaveLength(0);
      expect(events.emitted).toHaveLength(0);
    },
  );

  it.each([
    '2027-03-10T00:00:00.000Z',
    '2027-03-10T14:00:00Z',
    '2027-03-11T00:00:00Z',
  ])(
    'blocks preview and cancellation at or after check-in: %s',
    async (now) => {
      const reservation = await seed();
      vi.setSystemTime(new Date(now));
      for (const action of ['refundPreview', 'cancel'] as const) {
        await expect(
          service[action](reservation.id, USER),
        ).rejects.toMatchObject({
          status: 409,
          response: { code: ErrorCode.InvalidStatusTransition },
        });
      }
      expect(hotels.data.roomNights).toHaveLength(4);
    },
  );

  it.each(['refundPreview', 'cancel'] as const)(
    '%s hides missing, malformed and other users’ reservations',
    async (action) => {
      const reservation = await seed();
      for (const [id, user] of [
        [reservation.id, new Types.ObjectId().toHexString()],
        [new Types.ObjectId().toHexString(), USER],
        ['not-an-id', USER],
        [reservation.id, 'not-an-id'],
      ]) {
        await expect(service[action](id, user)).rejects.toMatchObject({
          status: 404,
          response: { code: ErrorCode.NotFound },
        });
      }
    },
  );

  it('rolls the status back and emits nothing if inventory release fails', async () => {
    const reservation = await seed();
    const failure = new ConflictException({
      code: ErrorCode.ConcurrentChange,
      message: 'Release failed',
    });
    vi.spyOn(inventory, 'release').mockRejectedValueOnce(failure);
    await expect(service.cancel(reservation.id, USER)).rejects.toBe(failure);
    const saved = await reservations.findById(reservation.id).lean();
    expect(saved?.status).toBe('confirmed');
    expect(saved?.cancellation).toBeUndefined();
    expect(hotels.data.roomNights).toHaveLength(4);
    expect(payments.refunds).toHaveLength(0);
    expect(events.emitted).toHaveLength(0);
  });

  it('parallel cancellations change status, release inventory and refund exactly once', async () => {
    const reservation = await seed();
    const release = vi.spyOn(inventory, 'release');
    const result = await Promise.allSettled([
      service.cancel(reservation.id, USER),
      service.cancel(reservation.id, USER),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      status: 409,
      response: { code: ErrorCode.InvalidStatusTransition },
    });
    expect((await reservations.findById(reservation.id).lean())?.status).toBe(
      'cancelled',
    );
    expect(hotels.data.roomNights).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(payments.refunds).toHaveLength(1);
    expect(events.payloadsOf(Events.HotelReservationCancelled)).toHaveLength(1);
  });

  it('keeps cancellation committed and emits the event if the post-commit refund throws', async () => {
    const reservation = await seed();
    const failure = new Error('Refund dependency unavailable');
    vi.spyOn(payments, 'refund').mockRejectedValueOnce(failure);
    await expect(service.cancel(reservation.id, USER)).rejects.toBe(failure);
    expect((await reservations.findById(reservation.id).lean())?.status).toBe(
      'cancelled',
    );
    expect(hotels.data.roomNights).toHaveLength(0);
    expect(events.payloadsOf(Events.HotelReservationCancelled)).toHaveLength(1);
  });

  it('returns a recorded failed refund without pretending cancellation rolled back', async () => {
    const reservation = await seed();
    vi.spyOn(payments, 'refund').mockImplementation(async (request) => {
      const refund = await FakePaymentsService.prototype.refund.call(
        payments,
        request,
      );
      payments.setStatus(refund.refundId, 'failed');
      return refund;
    });
    expect((await service.cancel(reservation.id, USER)).refund?.status).toBe(
      'failed',
    );
    expect(hotels.data.roomNights).toHaveLength(0);
  });
});
