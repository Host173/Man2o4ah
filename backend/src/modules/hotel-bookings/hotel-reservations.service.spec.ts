import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelHoldService } from './hotel-hold.service.js';
import { HotelReservationGroup } from './hotel-bookings.types.js';
import { HotelReservationsService } from './hotel-reservations.service.js';
import { HotelStayCompletionJob } from './hotel-stay-completion.job.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

const HOTEL_A = '6553a1f0c2b4e8a9d0f1a901';
const HOTEL_B = '6553a1f0c2b4e8a9d0f1a902';
const ROOM_A1 = '6553a1f0c2b4e8a9d0f1a911';
const ROOM_B1 = '6553a1f0c2b4e8a9d0f1a912';
const USER_A = '6553a1f0c2b4e8a9d0f1a991';
const USER_B = '6553a1f0c2b4e8a9d0f1a992';

function seededHotels(): FakeHotelsService {
  return new FakeHotelsService({
    hotels: [
      {
        id: HOTEL_A,
        name: 'Nile View',
        address: '1 Corniche',
        cityId: 'cairo',
        countryCode: 'EG',
        photos: [],
        amenities: [],
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationPolicy: {
          tiers: [{ daysBefore: 3, refundPercent: 50 }],
        },
        isActive: true,
        ratingSummary: { average: null, count: 0 },
      },
      {
        id: HOTEL_B,
        name: 'Pyramids Inn',
        address: '12 Giza Rd',
        cityId: 'cairo',
        countryCode: 'EG',
        photos: [],
        amenities: [],
        checkInTime: '15:00',
        checkOutTime: '11:00',
        cancellationPolicy: { tiers: [] },
        isActive: true,
        ratingSummary: { average: null, count: 0 },
      },
    ],
    rooms: [
      {
        id: ROOM_A1,
        hotelId: HOTEL_A,
        name: '101',
        type: 'Double',
        beds: 1,
        maxOccupancy: 3,
        pricePerNightMinor: 10_000,
        isActive: true,
        availability: [
          {
            fromDate: toDateOnly('2026-01-01'),
            toDate: toDateOnly('2027-12-31'),
          },
        ],
        hasEverBeenReserved: false,
      },
      {
        id: ROOM_B1,
        hotelId: HOTEL_B,
        name: '201',
        type: 'Suite',
        beds: 2,
        maxOccupancy: 4,
        pricePerNightMinor: 25_000,
        isActive: true,
        availability: [
          {
            fromDate: toDateOnly('2026-01-01'),
            toDate: toDateOnly('2027-12-31'),
          },
        ],
        hasEverBeenReserved: false,
      },
    ],
    roomNights: [],
  });
}

describe('HotelReservationsService (HTL-20)', () => {
  let t: TestApp;
  let holds: HotelHoldService;
  let service: HotelReservationsService;
  let completionJob: HotelStayCompletionJob;
  let reservations: Model<HotelReservation>;
  const hotels = new FakeHotelsService();
  const inventory = new FakeRoomNightInventory(hotels);
  const events = new FakeEvents();
  const payments = new FakePaymentsService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(HotelsService)
          .useValue(hotels)
          .overrideProvider(RoomNightInventory)
          .useValue(inventory)
          .overrideProvider(AppEvents)
          .useValue(events)
          .overrideProvider(PaymentsService)
          .useValue(payments),
    });
    holds = t.moduleRef.get(HotelHoldService);
    service = t.moduleRef.get(HotelReservationsService);
    completionJob = t.moduleRef.get(HotelStayCompletionJob);
    reservations = t.moduleRef.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    Object.assign(hotels, seededHotels());
    events.clear();
    payments.refunds.length = 0;
    await clearCollections(t.connection);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function seedReservation(options: {
    _id?: Types.ObjectId;
    userId?: string;
    hotelId?: string;
    roomId?: string;
    roomName?: string;
    roomType?: string;
    pricePerNightMinor?: number;
    adults?: number;
    childAges?: number[];
    status: HotelReservationStatus;
    reference?: string;
    checkInDate: string;
    checkOutDate: string;
    holdExpiresAt?: Date;
    confirmedAt?: Date;
    expiredAt?: Date;
    completedAt?: Date;
    cancellation?: {
      cancelledAt: Date;
      cancelledBy: 'user';
      refundPercent: number;
      refundAmountMinor: number;
    };
  }) {
    const checkIn = toDateOnly(options.checkInDate);
    const checkOut = toDateOnly(options.checkOutDate);
    const nights = Math.round(
      (checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000),
    );
    const rate = options.pricePerNightMinor ?? 10_000;
    const subtotalMinor = nights * rate;
    return reservations.create({
      _id: options._id ?? new Types.ObjectId(),
      userId: new Types.ObjectId(options.userId ?? USER_A),
      hotelId: new Types.ObjectId(options.hotelId ?? HOTEL_A),
      ...(options.reference ? { reference: options.reference } : {}),
      status: options.status,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      nights,
      rooms: [
        {
          roomId: new Types.ObjectId(options.roomId ?? ROOM_A1),
          roomName: options.roomName ?? '101',
          roomType: options.roomType ?? 'Double',
          pricePerNightMinor: rate,
          adults: options.adults ?? 2,
          childAges: options.childAges ?? [],
          subtotalMinor,
        },
      ],
      totalMinor: subtotalMinor,
      currency: 'USD',
      policySnapshot: {
        cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      holdExpiresAt:
        options.holdExpiresAt ?? new Date('2027-03-01T10:10:00.000Z'),
      ...(options.confirmedAt ? { confirmedAt: options.confirmedAt } : {}),
      ...(options.expiredAt ? { expiredAt: options.expiredAt } : {}),
      ...(options.completedAt ? { completedAt: options.completedAt } : {}),
      ...(options.cancellation ? { cancellation: options.cancellation } : {}),
    });
  }

  it('returns the refund with its status on getMineById, and only for the owner (PAY-03)', async () => {
    const cancelled = await seedReservation({
      status: HotelReservationStatus.CANCELLED,
      checkInDate: '2027-06-01',
      checkOutDate: '2027-06-03',
    });
    const pending = await seedReservation({
      status: HotelReservationStatus.PENDING_PAYMENT,
      checkInDate: '2027-07-01',
      checkOutDate: '2027-07-02',
    });
    const refund = await payments.refund({
      bookingType: 'hotel',
      bookingId: cancelled._id.toHexString(),
      amountMinor: 10_000,
      currency: 'USD',
      reason: 'user_cancellation',
    });
    payments.setStatus(refund.refundId, 'failed');

    expect(
      (await service.getMineById(cancelled._id.toHexString(), USER_A)).refund,
    ).toEqual({ ...refund, status: 'failed' });
    expect(
      (await service.getMineById(pending._id.toHexString(), USER_A)).refund,
    ).toBeNull();

    const spy = vi.spyOn(payments, 'getRefund');
    await expect(
      service.getMineById(cancelled._id.toHexString(), USER_B),
    ).rejects.toMatchObject({ status: 404 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('scopes listMine and getMineById strictly to the owning user', async () => {
    const now = new Date('2027-03-10T12:00:00.000Z');
    const ownUpcoming = await seedReservation({
      userId: USER_A,
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HROWN001',
      checkInDate: '2027-03-15',
      checkOutDate: '2027-03-17',
    });
    const otherUpcoming = await seedReservation({
      userId: USER_B,
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HROTH001',
      checkInDate: '2027-03-15',
      checkOutDate: '2027-03-17',
    });
    await seedReservation({
      userId: USER_B,
      status: HotelReservationStatus.CANCELLED,
      checkInDate: '2027-03-20',
      checkOutDate: '2027-03-22',
      cancellation: {
        cancelledAt: new Date('2027-03-05T10:00:00.000Z'),
        cancelledBy: 'user',
        refundPercent: 100,
        refundAmountMinor: 20_000,
      },
    });

    const page = await service.listMine(
      USER_A,
      { group: HotelReservationGroup.UPCOMING },
      now,
    );
    expect(page.total).toBe(1);
    expect(page.items.map((item) => item._id)).toEqual([
      ownUpcoming._id.toHexString(),
    ]);

    const cancelled = await service.listMine(
      USER_A,
      { group: HotelReservationGroup.CANCELLED },
      now,
    );
    expect(cancelled).toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });

    await expect(
      service.getMineById(otherUpcoming._id.toHexString(), USER_A),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: ErrorCode.NotFound },
    });
    await expect(
      service.getMineById(new Types.ObjectId().toHexString(), USER_A),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: ErrorCode.NotFound },
    });
  });

  it('classifies future, ongoing, past, pending_payment, expired, cancelled, and job-boundary reservations', async () => {
    const now = new Date('2027-03-10T15:30:00.000Z');

    // Upcoming: future confirmed, ongoing confirmed, checkout today confirmed, future pending
    const futureConfirmed = await seedReservation({
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HRUP0001',
      checkInDate: '2027-03-15',
      checkOutDate: '2027-03-17',
    });
    const ongoingConfirmed = await seedReservation({
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HRUP0002',
      checkInDate: '2027-03-08',
      checkOutDate: '2027-03-12',
    });
    const checkingOutToday = await seedReservation({
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HRUP0003',
      checkInDate: '2027-03-08',
      checkOutDate: '2027-03-10',
    });
    const futurePending = await seedReservation({
      status: HotelReservationStatus.PENDING_PAYMENT,
      checkInDate: '2027-03-20',
      checkOutDate: '2027-03-22',
      holdExpiresAt: new Date(now.getTime() + 1),
    });

    // Past: confirmed awaiting hourly completion job, completed, expired, past/overdue pending
    const awaitingCompletion = await seedReservation({
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HRPAST01',
      checkInDate: '2027-03-07',
      checkOutDate: '2027-03-09',
      confirmedAt: new Date('2027-03-01T10:05:00.000Z'),
    });
    const completed = await seedReservation({
      status: HotelReservationStatus.COMPLETED,
      reference: 'HRPAST02',
      checkInDate: '2027-03-01',
      checkOutDate: '2027-03-03',
      completedAt: new Date('2027-03-04T01:00:00.000Z'),
    });
    const expiredFutureDates = await seedReservation({
      status: HotelReservationStatus.EXPIRED,
      checkInDate: '2027-04-01',
      checkOutDate: '2027-04-03',
      expiredAt: new Date('2027-03-01T10:15:00.000Z'),
    });
    const pastPending = await seedReservation({
      status: HotelReservationStatus.PENDING_PAYMENT,
      checkInDate: '2027-03-04',
      checkOutDate: '2027-03-06',
    });
    const overduePending = await seedReservation({
      status: HotelReservationStatus.PENDING_PAYMENT,
      checkInDate: '2027-03-25',
      checkOutDate: '2027-03-27',
      holdExpiresAt: now,
    });

    // Cancelled: remains in cancelled regardless of past, ongoing, or future dates
    const cancelledPast = await seedReservation({
      status: HotelReservationStatus.CANCELLED,
      reference: 'HRCAN001',
      checkInDate: '2027-03-01',
      checkOutDate: '2027-03-03',
      cancellation: {
        cancelledAt: new Date('2027-02-20T10:00:00.000Z'),
        cancelledBy: 'user',
        refundPercent: 50,
        refundAmountMinor: 10_000,
      },
    });
    const cancelledFuture = await seedReservation({
      status: HotelReservationStatus.CANCELLED,
      reference: 'HRCAN002',
      checkInDate: '2027-03-25',
      checkOutDate: '2027-03-27',
      cancellation: {
        cancelledAt: new Date('2027-03-05T10:00:00.000Z'),
        cancelledBy: 'user',
        refundPercent: 100,
        refundAmountMinor: 20_000,
      },
    });

    const [upcomingList, pastList, cancelledList] = await Promise.all([
      service.listMine(
        USER_A,
        { group: HotelReservationGroup.UPCOMING, limit: 20 },
        now,
      ),
      service.listMine(
        USER_A,
        { group: HotelReservationGroup.PAST, limit: 20 },
        now,
      ),
      service.listMine(
        USER_A,
        { group: HotelReservationGroup.CANCELLED, limit: 20 },
        now,
      ),
    ]);

    expect(upcomingList.total).toBe(4);
    expect(new Set(upcomingList.items.map((item) => item._id))).toEqual(
      new Set([
        futureConfirmed._id.toHexString(),
        ongoingConfirmed._id.toHexString(),
        checkingOutToday._id.toHexString(),
        futurePending._id.toHexString(),
      ]),
    );
    // Unconfirmed pending_payment keeps no fabricated reference.
    const pendingItem = upcomingList.items.find(
      (i) => i._id === futurePending._id.toHexString(),
    );
    expect(pendingItem?.reference).toBeUndefined();
    expect('reference' in pendingItem!).toBe(false);

    expect(pastList.total).toBe(5);
    expect(new Set(pastList.items.map((item) => item._id))).toEqual(
      new Set([
        awaitingCompletion._id.toHexString(),
        completed._id.toHexString(),
        expiredFutureDates._id.toHexString(),
        pastPending._id.toHexString(),
        overduePending._id.toHexString(),
      ]),
    );
    const overdueItem = pastList.items.find(
      (i) => i._id === overduePending._id.toHexString(),
    );
    expect(overdueItem?.status).toBe('pending_payment');
    expect('reference' in overdueItem!).toBe(false);
    // Reading does not mutate the confirmed or overdue-pending stays.
    expect(
      pastList.items.find((i) => i._id === awaitingCompletion._id.toHexString())
        ?.status,
    ).toBe('confirmed');
    expect(
      (await reservations.findById(awaitingCompletion._id).lean())?.status,
    ).toBe('confirmed');
    expect(
      (await reservations.findById(overduePending._id).lean())?.status,
    ).toBe('pending_payment');

    expect(cancelledList.total).toBe(2);
    expect(new Set(cancelledList.items.map((item) => item._id))).toEqual(
      new Set([
        cancelledPast._id.toHexString(),
        cancelledFuture._id.toHexString(),
      ]),
    );

    // After the completion job runs, awaitingCompletion transitions to completed and remains in Past.
    await expect(completionJob.completeDueStays(now)).resolves.toBe(1);
    const pastAfterJob = await service.listMine(
      USER_A,
      { group: HotelReservationGroup.PAST, limit: 20 },
      now,
    );
    expect(
      pastAfterJob.items.find(
        (i) => i._id === awaitingCompletion._id.toHexString(),
      )?.status,
    ).toBe('completed');
    const detailAfterJob = await service.getMineById(
      awaitingCompletion._id.toHexString(),
      USER_A,
    );
    expect(detailAfterJob.status).toBe('completed');
    expect(detailAfterJob.completedAt).toEqual(now);
  });

  it('orders groups deterministically with an _id tie-breaker and paginates accurately', async () => {
    const now = new Date('2027-03-01T00:00:00.000Z');
    const idLow = new Types.ObjectId('6553a1f0c2b4e8a9d0f10001');
    const idHigh = new Types.ObjectId('6553a1f0c2b4e8a9d0f10002');
    const idLatest = new Types.ObjectId('6553a1f0c2b4e8a9d0f10003');

    // Upcoming: checkInDate asc, _id asc
    await seedReservation({
      _id: idLatest,
      status: HotelReservationStatus.CONFIRMED,
      checkInDate: '2027-03-20',
      checkOutDate: '2027-03-22',
    });
    await seedReservation({
      _id: idHigh,
      status: HotelReservationStatus.CONFIRMED,
      checkInDate: '2027-03-10',
      checkOutDate: '2027-03-12',
    });
    await seedReservation({
      _id: idLow,
      status: HotelReservationStatus.CONFIRMED,
      checkInDate: '2027-03-10',
      checkOutDate: '2027-03-12',
    });

    const upPage1 = await service.listMine(
      USER_A,
      { group: HotelReservationGroup.UPCOMING, page: 1, limit: 2 },
      now,
    );
    expect(upPage1).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(upPage1.items.map((i) => i._id)).toEqual([
      idLow.toHexString(),
      idHigh.toHexString(),
    ]);

    const upPage2 = await service.listMine(
      USER_A,
      { group: HotelReservationGroup.UPCOMING, page: 2, limit: 2 },
      now,
    );
    expect(upPage2.items.map((i) => i._id)).toEqual([idLatest.toHexString()]);

    // Past: checkInDate desc, _id desc
    const pLow = new Types.ObjectId('6553a1f0c2b4e8a9d0f20001');
    const pHigh = new Types.ObjectId('6553a1f0c2b4e8a9d0f20002');
    const pOlder = new Types.ObjectId('6553a1f0c2b4e8a9d0f20003');
    await seedReservation({
      _id: pOlder,
      status: HotelReservationStatus.COMPLETED,
      checkInDate: '2027-02-01',
      checkOutDate: '2027-02-03',
    });
    await seedReservation({
      _id: pLow,
      status: HotelReservationStatus.COMPLETED,
      checkInDate: '2027-02-15',
      checkOutDate: '2027-02-17',
    });
    await seedReservation({
      _id: pHigh,
      status: HotelReservationStatus.EXPIRED,
      checkInDate: '2027-02-15',
      checkOutDate: '2027-02-17',
    });

    const pastPage = await service.listMine(
      USER_A,
      { group: HotelReservationGroup.PAST, page: 1, limit: 10 },
      now,
    );
    expect(pastPage.items.map((i) => i._id)).toEqual([
      pHigh.toHexString(),
      pLow.toHexString(),
      pOlder.toHexString(),
    ]);
  });

  it('preserves room, price, and policy snapshots when hotel/room data changes, and reads inactive hotels', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-01T10:00:00.000Z'));

    const hold = await holds.hold(
      {
        hotelId: HOTEL_A,
        checkInDate: '2027-03-10',
        checkOutDate: '2027-03-13',
        rooms: [{ roomId: ROOM_A1, adults: 2, childAges: [6] }],
      },
      USER_A,
    );

    // Mutate current hotel/room catalog and deactivate the hotel.
    hotels.data.hotels[0].name = 'Nile Grand Palace';
    hotels.data.hotels[0].isActive = false;
    hotels.data.hotels[0].checkInTime = '16:00';
    hotels.data.hotels[0].checkOutTime = '10:00';
    hotels.data.hotels[0].cancellationPolicy = { tiers: [] };
    hotels.data.rooms[0].name = '999';
    hotels.data.rooms[0].type = 'Presidential';
    hotels.data.rooms[0].pricePerNightMinor = 99_900;

    const list = await service.listMine(
      USER_A,
      { group: HotelReservationGroup.UPCOMING },
      new Date('2027-03-01T10:05:00.000Z'),
    );
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      _id: hold.reservationId,
      hotelId: HOTEL_A,
      hotelName: 'Nile Grand Palace',
      checkInDate: '2027-03-10',
      checkOutDate: '2027-03-13',
      nights: 3,
      totalMinor: 30_000,
      currency: 'USD',
      rooms: [
        {
          roomId: ROOM_A1,
          roomName: '101',
          roomType: 'Double',
          pricePerNightMinor: 10_000,
          adults: 2,
          childAges: [6],
          subtotalMinor: 30_000,
        },
      ],
    });

    const detail = await service.getMineById(hold.reservationId, USER_A);
    expect(detail).toMatchObject({
      _id: hold.reservationId,
      hotelName: 'Nile Grand Palace',
      totalMinor: 30_000,
      policy: {
        cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
    });
  });

  it('rejects with 500 INTERNAL_ERROR when referenced hotel metadata is missing', async () => {
    const stay = await seedReservation({
      status: HotelReservationStatus.CONFIRMED,
      reference: 'HRMISS01',
      checkInDate: '2027-04-10',
      checkOutDate: '2027-04-12',
    });
    hotels.data.hotels = [];

    await expect(
      service.listMine(
        USER_A,
        { group: HotelReservationGroup.UPCOMING },
        new Date('2027-03-01T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      status: 500,
      response: { code: ErrorCode.InternalError },
    });

    await expect(
      service.getMineById(stay._id.toHexString(), USER_A),
    ).rejects.toMatchObject({
      status: 500,
      response: { code: ErrorCode.InternalError },
    });
  });

  it('validates query parameters, handles invalid IDs, and returns expired/completed lifecycle timestamps', async () => {
    await expect(
      service.listMine(USER_A, {
        group: 'invalid' as unknown as HotelReservationGroup,
        page: 0,
        limit: 51,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: ErrorCode.ValidationFailed,
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'group' }),
          expect.objectContaining({ field: 'page' }),
          expect.objectContaining({ field: 'limit' }),
        ]),
      },
    });

    await expect(service.listMine('not-an-object-id')).resolves.toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });

    await expect(service.getMineById('bad-id', USER_A)).rejects.toMatchObject({
      status: 400,
      response: { code: ErrorCode.ValidationFailed },
    });

    await expect(
      service.getMineById(new Types.ObjectId().toHexString(), 'bad-user'),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: ErrorCode.NotFound },
    });

    const expiredAt = new Date('2027-03-01T10:10:00.000Z');
    const expired = await seedReservation({
      hotelId: HOTEL_B,
      roomId: ROOM_B1,
      status: HotelReservationStatus.EXPIRED,
      checkInDate: '2027-03-15',
      checkOutDate: '2027-03-17',
      expiredAt,
    });
    const detail = await service.getMineById(expired._id.toHexString(), USER_A);
    expect(detail).toMatchObject({
      _id: expired._id.toHexString(),
      hotelId: HOTEL_B,
      hotelName: 'Pyramids Inn',
      status: 'expired',
      expiredAt,
    });
    expect(Object.hasOwn(detail, 'reference')).toBe(false);
  });
});
