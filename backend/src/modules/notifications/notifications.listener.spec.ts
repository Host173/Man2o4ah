import { Logger } from '@nestjs/common';
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

  describe('duplicate delivery (handlers are idempotent)', () => {
    const provider = {
      providerType: 'airline' as const,
      providerId: PROVIDER,
      moderatorIds: MODERATORS,
    };

    describe.each<[string, () => Promise<unknown>, number]>([
      [
        Events.FlightBookingConfirmed,
        () => emitter.emitAsync(Events.FlightBookingConfirmed, booking),
        1,
      ],
      [
        Events.FlightBookingCancelled,
        () => emitter.emitAsync(Events.FlightBookingCancelled, booking),
        1,
      ],
      [
        Events.HotelReservationConfirmed,
        () => emitter.emitAsync(Events.HotelReservationConfirmed, booking),
        1,
      ],
      [
        Events.HotelReservationCancelled,
        () => emitter.emitAsync(Events.HotelReservationCancelled, booking),
        1,
      ],
      [
        Events.RefundUpdated,
        () =>
          emitter.emitAsync(Events.RefundUpdated, {
            refundId: REFUND,
            userId: USER,
            status: 'refunded',
          }),
        1,
      ],
      [
        Events.FlightBookingRescheduled,
        () =>
          emitter.emitAsync(Events.FlightBookingRescheduled, {
            bookingId: BOOKING,
            userId: USER,
          }),
        1,
      ],
      [
        Events.AccountSuspended,
        () => emitter.emitAsync(Events.AccountSuspended, { userId: USER }),
        1,
      ],
      [
        Events.AccountReactivated,
        () => emitter.emitAsync(Events.AccountReactivated, { userId: USER }),
        1,
      ],
      [
        Events.ProviderDeactivated,
        () => emitter.emitAsync(Events.ProviderDeactivated, provider),
        MODERATORS.length,
      ],
      [
        Events.ProviderReactivated,
        () => emitter.emitAsync(Events.ProviderReactivated, provider),
        MODERATORS.length,
      ],
    ])('%s', (_event, emit, expected) => {
      it('stores the event only once when it is delivered twice', async () => {
        await emit();
        await emit();
        expect(await model.countDocuments()).toBe(expected);
      });

      it('stores one notification per recipient under concurrent delivery', async () => {
        const errors = vi.spyOn(Logger.prototype, 'error');
        try {
          const results = await Promise.allSettled(
            Array.from({ length: 8 }, emit),
          );
          expect(results.every((result) => result.status === 'fulfilled')).toBe(
            true,
          );
          expect(await model.countDocuments()).toBe(expected);
          expect(await model.countDocuments({ readAt: null })).toBe(expected);
          expect(errors).not.toHaveBeenCalled();
        } finally {
          errors.mockRestore();
        }
      });
    });

    it('stores one notification per moderator when a moderator id repeats', async () => {
      const [first = '', second = ''] = MODERATORS;
      await emitter.emitAsync(Events.ProviderDeactivated, {
        ...provider,
        moderatorIds: [first, first, second],
      });
      const docs = await stored();
      expect(docs.map((doc) => doc.userId.toString())).toEqual([first, second]);
    });

    it('stores each refund status once, in order', async () => {
      for (const status of ['pending', 'pending', 'refunded'] as const) {
        await emitter.emitAsync(Events.RefundUpdated, {
          refundId: REFUND,
          userId: USER,
          status,
        });
      }
      const docs = await stored();
      expect(docs.map((doc) => doc.message)).toEqual([
        'Your refund is being processed.',
        'Your refund is complete.',
      ]);
    });

    it('notifies again when an account is suspended a second time after a reactivation', async () => {
      await emitter.emitAsync(Events.AccountSuspended, { userId: USER });
      await emitter.emitAsync(Events.AccountReactivated, { userId: USER });
      await emitter.emitAsync(Events.AccountSuspended, { userId: USER });
      const docs = await stored();
      expect(docs.map((doc) => doc.type)).toEqual([
        'account_suspended',
        'account_reactivated',
        'account_suspended',
      ]);
    });

    it('notifies again when a provider is deactivated a second time after a reactivation', async () => {
      const one = { ...provider, moderatorIds: [MODERATORS[0] ?? ''] };
      await emitter.emitAsync(Events.ProviderDeactivated, one);
      await emitter.emitAsync(Events.ProviderReactivated, one);
      await emitter.emitAsync(Events.ProviderDeactivated, one);
      const docs = await stored();
      expect(docs.map((doc) => doc.type)).toEqual([
        'provider_deactivated',
        'provider_reactivated',
        'provider_deactivated',
      ]);
    });

    it('notifies about a new reschedule once the earlier one was read', async () => {
      const rescheduled = { bookingId: BOOKING, userId: USER };
      await emitter.emitAsync(Events.FlightBookingRescheduled, rescheduled);
      await model.updateMany({}, { $set: { readAt: new Date() } });
      await emitter.emitAsync(Events.FlightBookingRescheduled, rescheduled);
      expect(await model.countDocuments()).toBe(2);
      expect(await model.countDocuments({ readAt: null })).toBe(1);
    });
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
