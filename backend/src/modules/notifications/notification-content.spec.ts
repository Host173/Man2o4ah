import type { ProviderType } from '../accounts/schemas/user.schema.js';
import type { RefundStatus } from '../payments/schemas/refund.schema.js';
import {
  accountReactivated,
  accountSuspended,
  bookingCancelled,
  bookingConfirmed,
  flightBookingRescheduled,
  providerDeactivated,
  providerReactivated,
  refundUpdated,
} from './notification-content.js';

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

describe('notification content (GEN-01)', () => {
  it('builds the flight booking confirmed notification', () => {
    expect(bookingConfirmed('flight', booking)).toEqual([
      {
        userId: USER,
        type: 'booking_confirmed',
        title: 'Flight booking confirmed',
        message: 'Your flight booking FB-1234 is confirmed.',
        entity: { type: 'flight_booking', id: BOOKING },
      },
    ]);
  });

  it('builds the flight booking cancelled notification', () => {
    expect(bookingCancelled('flight', booking)).toEqual([
      {
        userId: USER,
        type: 'booking_cancelled',
        title: 'Flight booking cancelled',
        message: 'Your flight booking FB-1234 was cancelled.',
        entity: { type: 'flight_booking', id: BOOKING },
      },
    ]);
  });

  it('builds the hotel reservation confirmed notification', () => {
    expect(bookingConfirmed('hotel', booking)).toEqual([
      {
        userId: USER,
        type: 'booking_confirmed',
        title: 'Hotel reservation confirmed',
        message: 'Your hotel reservation FB-1234 is confirmed.',
        entity: { type: 'hotel_reservation', id: BOOKING },
      },
    ]);
  });

  it('builds the hotel reservation cancelled notification', () => {
    expect(bookingCancelled('hotel', booking)).toEqual([
      {
        userId: USER,
        type: 'booking_cancelled',
        title: 'Hotel reservation cancelled',
        message: 'Your hotel reservation FB-1234 was cancelled.',
        entity: { type: 'hotel_reservation', id: BOOKING },
      },
    ]);
  });

  it.each<[RefundStatus, string]>([
    ['pending', 'Your refund is being processed.'],
    ['refunded', 'Your refund is complete.'],
    ['failed', 'Your refund failed. Please contact support.'],
  ])('builds the refund notification for status %s', (status, message) => {
    expect(refundUpdated({ refundId: REFUND, userId: USER, status })).toEqual([
      {
        userId: USER,
        type: 'refund_updated',
        title: 'Refund update',
        message,
        entity: { type: 'refund', id: REFUND },
      },
    ]);
  });

  it('builds the flight schedule changed notification', () => {
    expect(
      flightBookingRescheduled({ bookingId: BOOKING, userId: USER }),
    ).toEqual([
      {
        userId: USER,
        type: 'flight_schedule_changed',
        title: 'Flight schedule changed',
        message:
          'A flight in your booking has new times. Check your booking for the new schedule.',
        entity: { type: 'flight_booking', id: BOOKING },
      },
    ]);
  });

  it('builds the account suspended notification without an entity', () => {
    const [item] = accountSuspended({ userId: USER });
    expect(item).toEqual({
      userId: USER,
      type: 'account_suspended',
      title: 'Account suspended',
      message: 'Your account was suspended by an administrator.',
    });
    expect(item).not.toHaveProperty('entity');
  });

  it('builds the account reactivated notification without an entity', () => {
    const [item] = accountReactivated({ userId: USER });
    expect(item).toEqual({
      userId: USER,
      type: 'account_reactivated',
      title: 'Account reactivated',
      message: 'Your account is active again.',
    });
    expect(item).not.toHaveProperty('entity');
  });

  it.each<[ProviderType, string]>([
    ['airline', 'Airline'],
    ['hotel', 'Hotel'],
  ])(
    'builds one deactivated notification per moderator of a %s',
    (providerType, label) => {
      const items = providerDeactivated({
        providerType,
        providerId: PROVIDER,
        moderatorIds: MODERATORS,
      });
      expect(items).toHaveLength(3);
      expect(items.map((item) => item.userId)).toEqual(MODERATORS);
      for (const item of items) {
        expect(item).toMatchObject({
          type: 'provider_deactivated',
          title: `${label} deactivated`,
          message: `Your ${providerType} was deactivated by an administrator.`,
          entity: { type: providerType, id: PROVIDER },
        });
      }
    },
  );

  it.each<[ProviderType, string]>([
    ['airline', 'Airline'],
    ['hotel', 'Hotel'],
  ])(
    'builds one reactivated notification per moderator of a %s',
    (providerType, label) => {
      const items = providerReactivated({
        providerType,
        providerId: PROVIDER,
        moderatorIds: MODERATORS,
      });
      expect(items).toHaveLength(3);
      expect(items.map((item) => item.userId)).toEqual(MODERATORS);
      for (const item of items) {
        expect(item).toMatchObject({
          type: 'provider_reactivated',
          title: `${label} reactivated`,
          message: `Your ${providerType} is active again.`,
          entity: { type: providerType, id: PROVIDER },
        });
      }
    },
  );

  it('builds nothing for a provider event without moderators', () => {
    const payload = {
      providerType: 'airline' as const,
      providerId: PROVIDER,
      moderatorIds: [],
    };
    expect(providerDeactivated(payload)).toEqual([]);
    expect(providerReactivated(payload)).toEqual([]);
  });

  it('keeps every title within 100 and every message within 500 characters', () => {
    const long = {
      bookingId: BOOKING,
      userId: USER,
      reference: 'R'.repeat(40),
    };
    const items = [
      ...bookingConfirmed('flight', long),
      ...bookingConfirmed('hotel', long),
      ...bookingCancelled('flight', long),
      ...bookingCancelled('hotel', long),
      ...(['pending', 'refunded', 'failed'] as const).flatMap((status) =>
        refundUpdated({ refundId: REFUND, userId: USER, status }),
      ),
      ...flightBookingRescheduled({ bookingId: BOOKING, userId: USER }),
      ...accountSuspended({ userId: USER }),
      ...accountReactivated({ userId: USER }),
      ...providerDeactivated({
        providerType: 'hotel',
        providerId: PROVIDER,
        moderatorIds: MODERATORS,
      }),
      ...providerReactivated({
        providerType: 'airline',
        providerId: PROVIDER,
        moderatorIds: MODERATORS,
      }),
    ];
    for (const item of items) {
      expect(item.title.length).toBeLessThanOrEqual(100);
      expect(item.message.length).toBeLessThanOrEqual(500);
    }
  });
});
