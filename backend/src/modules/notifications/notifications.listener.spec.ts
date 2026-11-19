import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { Events } from '../../common/events/events.js';
import type { EventPayloads } from '../../common/events/event-payloads.js';
import { NotificationsModule } from './notifications.module.js';
import { Notification } from './schemas/notification.schema.js';

const USER = '6736f0b2c5a1b2c3d4e5f601';
const BOOKING = '6736f0b2c5a1b2c3d4e5f602';
const REFUND = '6736f0b2c5a1b2c3d4e5f603';
const PROVIDER = '6736f0b2c5a1b2c3d4e5f604';
const MODERATORS = [
  '6736f0b2c5a1b2c3d4e5f6a1',
  '6736f0b2c5a1b2c3d4e5f6a2',
  '6736f0b2c5a1b2c3d4e5f6a3',
];
const booking = { bookingId: BOOKING, userId: USER, reference: 'FB-1234' };

interface Expected {
  type: string;
  title: string;
  message: string;
  entity?: { type: string; id: string };
}

describe('NotificationsListener (GEN-01)', () => {
  let t: TestApp;
  let emitter: EventEmitter2;
  let model: Model<Notification>;

  beforeAll(async () => {
    t = await createTestApp({ imports: [NotificationsModule] });
    emitter = t.moduleRef.get(EventEmitter2);
    model = t.moduleRef.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  afterAll(() => t.close(), HOOK_TIMEOUT);

  const stored = () => model.find().sort({ _id: 1 }).lean();

  async function expectStored(
    userIds: string[],
    expected: Expected,
  ): Promise<void> {
    const docs = await stored();
    expect(docs.map((doc) => doc.userId.toString())).toEqual(userIds);
    for (const doc of docs) {
      expect(doc.userId).toBeInstanceOf(Types.ObjectId);
      expect(doc.type).toBe(expected.type);
      expect(doc.title).toBe(expected.title);
      expect(doc.message).toBe(expected.message);
      if (expected.entity) {
        expect(doc.entity).toEqual(expected.entity);
      } else {
        expect(doc.entity).toBeUndefined();
      }
      expect(doc.readAt).toBeNull();
    }
  }

  it('stores a notification for flight-booking.confirmed', async () => {
    await emitter.emitAsync(Events.FlightBookingConfirmed, booking);
    await expectStored([USER], {
      type: 'booking_confirmed',
      title: 'Flight booking confirmed',
      message: 'Your flight booking FB-1234 is confirmed.',
      entity: { type: 'flight_booking', id: BOOKING },
    });
  });

  it('stores a notification for flight-booking.cancelled', async () => {
    await emitter.emitAsync(Events.FlightBookingCancelled, booking);
    await expectStored([USER], {
      type: 'booking_cancelled',
      title: 'Flight booking cancelled',
      message: 'Your flight booking FB-1234 was cancelled.',
      entity: { type: 'flight_booking', id: BOOKING },
    });
  });

  it('stores a notification for hotel-reservation.confirmed', async () => {
    await emitter.emitAsync(Events.HotelReservationConfirmed, booking);
    await expectStored([USER], {
      type: 'booking_confirmed',
      title: 'Hotel reservation confirmed',
      message: 'Your hotel reservation FB-1234 is confirmed.',
      entity: { type: 'hotel_reservation', id: BOOKING },
    });
  });

  it('stores a notification for hotel-reservation.cancelled', async () => {
    await emitter.emitAsync(Events.HotelReservationCancelled, booking);
    await expectStored([USER], {
      type: 'booking_cancelled',
      title: 'Hotel reservation cancelled',
      message: 'Your hotel reservation FB-1234 was cancelled.',
      entity: { type: 'hotel_reservation', id: BOOKING },
    });
  });

  it.each<[EventPayloads['refund.updated']['status'], string]>([
    ['pending', 'Your refund is being processed.'],
    ['refunded', 'Your refund is complete.'],
    ['failed', 'Your refund failed. Please contact support.'],
  ])(
    'stores a notification for refund.updated (%s)',
    async (status, message) => {
      await emitter.emitAsync(Events.RefundUpdated, {
        refundId: REFUND,
        userId: USER,
        status,
      });
      await expectStored([USER], {
        type: 'refund_updated',
        title: 'Refund update',
        message,
        entity: { type: 'refund', id: REFUND },
      });
    },
  );

  it('stores a notification for flight-booking.rescheduled', async () => {
    await emitter.emitAsync(Events.FlightBookingRescheduled, {
      bookingId: BOOKING,
      userId: USER,
    });
    await expectStored([USER], {
      type: 'flight_schedule_changed',
      title: 'Flight schedule changed',
      message:
        'A flight in your booking has new times. Check your booking for the new schedule.',
      entity: { type: 'flight_booking', id: BOOKING },
    });
  });

  it('stores a notification without an entity for account.suspended', async () => {
    await emitter.emitAsync(Events.AccountSuspended, { userId: USER });
    await expectStored([USER], {
      type: 'account_suspended',
      title: 'Account suspended',
      message: 'Your account was suspended by an administrator.',
    });
  });

  it('stores a notification without an entity for account.reactivated', async () => {
    await emitter.emitAsync(Events.AccountReactivated, { userId: USER });
    await expectStored([USER], {
      type: 'account_reactivated',
      title: 'Account reactivated',
      message: 'Your account is active again.',
    });
  });

  it('stores one notification per moderator for provider.deactivated', async () => {
    await emitter.emitAsync(Events.ProviderDeactivated, {
      providerType: 'airline',
      providerId: PROVIDER,
      moderatorIds: MODERATORS,
    });
    await expectStored(MODERATORS, {
      type: 'provider_deactivated',
      title: 'Airline deactivated',
      message: 'Your airline was deactivated by an administrator.',
      entity: { type: 'airline', id: PROVIDER },
    });
  });

  it('stores one notification per moderator for provider.reactivated', async () => {
    await emitter.emitAsync(Events.ProviderReactivated, {
      providerType: 'hotel',
      providerId: PROVIDER,
      moderatorIds: MODERATORS,
    });
    await expectStored(MODERATORS, {
      type: 'provider_reactivated',
      title: 'Hotel reactivated',
      message: 'Your hotel is active again.',
      entity: { type: 'hotel', id: PROVIDER },
    });
  });

  it('stores nothing for a provider event without moderators', async () => {
    await emitter.emitAsync(Events.ProviderDeactivated, {
      providerType: 'airline',
      providerId: PROVIDER,
      moderatorIds: [],
    });
    expect(await model.countDocuments()).toBe(0);
  });

  it('stores nothing and does not throw for an invalid user id', async () => {
    await expect(
      emitter.emitAsync(Events.AccountSuspended, { userId: 'not-an-id' }),
    ).resolves.toBeDefined();
    expect(await model.countDocuments()).toBe(0);
  });

  it('skips an invalid moderator id and stores the other two', async () => {
    await emitter.emitAsync(Events.ProviderReactivated, {
      providerType: 'airline',
      providerId: PROVIDER,
      moderatorIds: [MODERATORS[0] ?? '', 'not-an-id', MODERATORS[2] ?? ''],
    });
    const docs = await stored();
    expect(docs.map((doc) => doc.userId.toString())).toEqual([
      MODERATORS[0],
      MODERATORS[2],
    ]);
  });

  it('does not throw to the emitter when storing fails', async () => {
    const insertMany = vi
      .spyOn(model, 'insertMany')
      .mockRejectedValueOnce(new Error('database is down'));
    await expect(
      emitter.emitAsync(Events.AccountReactivated, { userId: USER }),
    ).resolves.toBeDefined();
    expect(insertMany).toHaveBeenCalledTimes(1);
    insertMany.mockRestore();
    expect(await model.countDocuments()).toBe(0);
  });
});
