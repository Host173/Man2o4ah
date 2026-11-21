import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { SMTP_CONFIG } from '../../config/smtp-config.js';
import { Events } from '../../common/events/events.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { EmailRecipientRegistry } from './ports/email-recipient.registry.js';
import { EmailDeliveryService } from './email-delivery.service.js';
import {
  EmailDeliveryWorker,
  MODERATOR_INVITATION_TEXT,
} from './email-delivery.worker.js';
import { EmailDelivery } from './schemas/email-delivery.schema.js';
import { Notification } from './schemas/notification.schema.js';
import { NotificationsService } from './notifications.service.js';
import { SmtpDeliveryError, SmtpMailer } from './smtp-mailer.js';
import type { EmailMessage } from './smtp-mailer.js';

const USER = '6736f0b2c5a1b2c3d4e5f601';
const BOOKING = '6736f0b2c5a1b2c3d4e5f602';
const SECOND = '6736f0b2c5a1b2c3d4e5f603';
const booking = { userId: USER, bookingId: BOOKING, reference: 'REF-123' };
const invitation = { userId: USER, eventId: `moderator-created:${USER}` };

describe('Email delivery integration (GEN-01-B)', () => {
  let t: TestApp;
  let emitter: EventEmitter2;
  let worker: EmailDeliveryWorker;
  let service: EmailDeliveryService;
  let deliveries: Model<EmailDelivery>;
  let notifications: Model<Notification>;
  const send = vi.fn<(message: EmailMessage) => Promise<void>>();
  const recipients = {
    register: vi.fn(),
    getRecipient:
      vi.fn<
        (userId: string) => Promise<{ userId: string; email: string } | null>
      >(),
  };
  let logs: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) =>
        b
          .overrideProvider(SMTP_CONFIG)
          .useValue({ enabled: true })
          .overrideProvider(SmtpMailer)
          .useValue({ send })
          .overrideProvider(EmailRecipientRegistry)
          .useValue(recipients),
    });
    emitter = t.moduleRef.get(EventEmitter2);
    worker = t.moduleRef.get(EmailDeliveryWorker);
    service = t.moduleRef.get(EmailDeliveryService);
    deliveries = t.moduleRef.get<Model<EmailDelivery>>(
      getModelToken(EmailDelivery.name),
    );
    notifications = t.moduleRef.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
  }, HOOK_TIMEOUT);
  beforeEach(async () => {
    await clearCollections(t.connection);
    send.mockReset().mockResolvedValue(undefined);
    recipients.getRecipient.mockReset().mockImplementation(async (userId) => ({
      userId,
      email: `${userId}@example.test`,
    }));
    logs = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => logs.mockRestore());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  it.each([
    [Events.FlightBookingConfirmed, booking, 'Flight booking confirmed'],
    [Events.FlightBookingCancelled, booking, 'Flight booking cancelled'],
    [Events.HotelReservationConfirmed, booking, 'Hotel reservation confirmed'],
    [Events.HotelReservationCancelled, booking, 'Hotel reservation cancelled'],
    [
      Events.RefundUpdated,
      { userId: USER, refundId: BOOKING, status: 'pending' },
      'Refund update',
    ],
    [
      Events.RefundUpdated,
      { userId: USER, refundId: BOOKING, status: 'refunded' },
      'Refund update',
    ],
    [
      Events.RefundUpdated,
      { userId: USER, refundId: BOOKING, status: 'failed' },
      'Refund update',
    ],
    [
      Events.FlightBookingRescheduled,
      { userId: USER, bookingId: BOOKING, eventId: 'times-1' },
      'Flight schedule changed',
    ],
    [
      Events.AccountSuspended,
      { userId: USER, eventId: 'state-1' },
      'Account suspended',
    ],
    [
      Events.AccountReactivated,
      { userId: USER, eventId: 'state-2' },
      'Account reactivated',
    ],
    [
      Events.ProviderDeactivated,
      {
        providerId: BOOKING,
        providerType: 'hotel',
        moderatorIds: [USER, SECOND],
        eventId: 'provider-1',
      },
      'Hotel deactivated',
    ],
    [
      Events.ProviderReactivated,
      {
        providerId: BOOKING,
        providerType: 'airline',
        moderatorIds: [USER, SECOND],
        eventId: 'provider-2',
      },
      'Airline reactivated',
    ],
  ])(
    'delivers %s from immutable in-app content',
    async (event, payload, subject) => {
      await emitter.emitAsync(event, payload);
      await worker.processDue();
      const stored = await notifications.find().lean();
      expect(stored.length).toBeGreaterThan(0);
      expect(send).toHaveBeenCalledTimes(stored.length);
      for (const record of stored) {
        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({
            to: `${record.userId.toString()}@example.test`,
            subject,
            text: record.message,
          }),
        );
      }
      expect(await deliveries.countDocuments({ status: 'sent' })).toBe(
        stored.length,
      );
    },
  );

  it('concurrent duplicate notification/invitation events and workers converge on one delivery per recipient', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        emitter.emitAsync(Events.FlightBookingConfirmed, booking),
      ),
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(logs).not.toHaveBeenCalled();
    await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        emitter.emitAsync(Events.ModeratorInvited, invitation),
      ),
    );
    expect(await notifications.countDocuments()).toBe(1);
    expect(await deliveries.countDocuments()).toBe(2);
    await Promise.allSettled(
      Array.from({ length: 8 }, () => worker.processDue()),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(await deliveries.countDocuments({ status: 'sent' })).toBe(2);
    await emitter.emitAsync(Events.FlightBookingConfirmed, booking);
    await emitter.emitAsync(Events.ModeratorInvited, invitation);
    await worker.processDue();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('invites a persisted moderator without credentials or a broken login link', async () => {
    const accounts = t.moduleRef.get(AccountsService);
    const account = await accounts.createModerator({
      name: 'Moderator',
      email: 'moderator@example.test',
      role: 'hotel_moderator',
      providerId: BOOKING,
      temporaryPassword: 'Temporary123',
    });
    await vi.waitFor(async () =>
      expect(await deliveries.countDocuments()).toBe(1),
    );
    expect(
      await t.connection
        .collection('users')
        .findOne({ _id: new Types.ObjectId(account.id) }),
    ).not.toBeNull();
    await worker.processDue();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Moderator invitation',
        text: MODERATOR_INVITATION_TEXT,
      }),
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain('Temporary123');
    expect(MODERATOR_INVITATION_TEXT).not.toMatch(/https?:|\/login/);
    await expect(
      accounts.createModerator({
        name: 'Duplicate',
        email: 'moderator@example.test',
        role: 'hotel_moderator',
        providerId: BOOKING,
        temporaryPassword: 'Temporary456',
      }),
    ).rejects.toMatchObject({ response: { code: 'EMAIL_TAKEN' } });
    expect(await deliveries.countDocuments()).toBe(1);
  });

  it('does not resend read alerts, but distinct repeatable event identities still deliver', async () => {
    const payload = {
      userId: USER,
      bookingId: BOOKING,
      eventId: 'reschedule-one',
    };
    await emitter.emitAsync(Events.FlightBookingRescheduled, payload);
    const record = await notifications.findOne().lean();
    if (!record) throw new Error('Expected notification');
    await t.moduleRef
      .get(NotificationsService)
      .markRead(USER, record._id.toString());
    await worker.processDue();
    await emitter.emitAsync(Events.FlightBookingRescheduled, payload);
    await emitter.emitAsync(Events.FlightBookingRescheduled, {
      ...payload,
      eventId: 'reschedule-two',
    });
    await worker.processDue();
    expect(await deliveries.countDocuments({ status: 'sent' })).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      (await notifications.findById(record._id).lean())?.readAt,
    ).not.toBeNull();
  });

  it('enforces the batch limit and leaves additional due mail for the next scan', async () => {
    for (let i = 0; i < 21; i += 1) {
      const id = new Types.ObjectId().toHexString();
      await service.enqueueInvitation({
        userId: id,
        eventId: `moderator-created:${id}`,
      });
    }
    await worker.processDue();
    expect(send).toHaveBeenCalledTimes(20);
    expect(await deliveries.countDocuments({ status: 'pending' })).toBe(1);
    await worker.processDue();
    expect(send).toHaveBeenCalledTimes(21);
  });

  it('validates kind/state fields and requires the enqueue caller transaction', async () => {
    const base = {
      deliveryKey: 'invitation:schema',
      userId: USER,
      kind: 'moderator_invitation',
      invitationEventId: 'schema',
    };
    for (const invalid of [
      { invitationEventId: undefined },
      { notificationId: BOOKING },
      { attempts: 1.5 },
      { attempts: -1 },
      { status: 'sending' },
      { leaseToken: '' },
      { sentAt: new Date() },
      { status: 'sent' },
    ]) {
      await expect(
        new deliveries({ ...base, ...invalid }).validate(),
      ).rejects.toThrow();
    }
    await expect(new deliveries(base).validate()).resolves.toBeUndefined();
    const session = await t.connection.startSession();
    try {
      await expect(
        service.enqueueNotification(BOOKING, USER, { session }),
      ).rejects.toThrow(/active transaction/);
    } finally {
      await session.endSession();
    }
  });

  it('uses the exact approved retry deadlines and restores only a missing queue identity on redelivery', async () => {
    await emitter.emitAsync(Events.FlightBookingConfirmed, booking);
    await deliveries.deleteMany({});
    await emitter.emitAsync(Events.FlightBookingConfirmed, booking);
    expect(await notifications.countDocuments()).toBe(1);
    expect(await deliveries.countDocuments()).toBe(1);
    const now = new Date(Date.now() + 1_000);
    for (let attempt = 1; attempt < 5; attempt += 1) {
      const claim = await service.claim(now);
      if (!claim) throw new Error('Expected claim');
      await service.finish(claim, now, 'smtp_transient');
      expect((await deliveries.findOne().lean())?.nextAttemptAt).toEqual(
        new Date(now.getTime() + 30_000 * 2 ** (attempt - 1)),
      );
      await deliveries.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
    }
  });

  it('retries transient failure durably and never sends persisted sent records again after worker reconstruction', async () => {
    send.mockRejectedValueOnce(new SmtpDeliveryError('smtp_transient'));
    await emitter.emitAsync(Events.ModeratorInvited, invitation);
    await worker.processDue();
    const pending = await deliveries.findOne().lean();
    expect(pending).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'smtp_transient',
    });
    await worker.processDue();
    expect(send).toHaveBeenCalledTimes(1);
    await deliveries.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
    await worker.processDue();
    expect(await deliveries.findOne().lean()).toMatchObject({
      status: 'sent',
      attempts: 2,
    });
    const restarted = new EmailDeliveryWorker(
      {
        enabled: true,
        host: 'localhost',
        port: 1025,
        secure: false,
        requireTLS: false,
        from: 'sender@example.test',
      },
      service,
      t.moduleRef.get(EmailRecipientRegistry),
      t.moduleRef.get(SmtpMailer),
      notifications,
    );
    await restarted.processDue();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each(['smtp_rejected', 'recipient_missing'] as const)(
    'records permanent %s failures without retries',
    async (category) => {
      if (category === 'recipient_missing')
        recipients.getRecipient.mockResolvedValue(null);
      else send.mockRejectedValue(new SmtpDeliveryError(category));
      await emitter.emitAsync(Events.ModeratorInvited, invitation);
      await worker.processDue();
      expect(await deliveries.findOne().lean()).toMatchObject({
        status: 'failed',
        lastError: category,
      });
      expect(logs).toHaveBeenCalled();
      await emitter.emitAsync(Events.ModeratorInvited, invitation);
      await worker.processDue();
      expect(await deliveries.countDocuments()).toBe(1);
      expect(send).toHaveBeenCalledTimes(
        category === 'recipient_missing' ? 0 : 1,
      );
    },
  );

  it('retries lookup/network failures to the approved bound and logs only categories', async () => {
    recipients.getRecipient.mockRejectedValue(
      new Error('private recipient or database data'),
    );
    await emitter.emitAsync(Events.ModeratorInvited, invitation);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await deliveries.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
      await worker.processDue();
    }
    expect(await deliveries.findOne().lean()).toMatchObject({
      status: 'failed',
      attempts: 5,
      lastError: 'attempts_exhausted',
    });
    expect(send).not.toHaveBeenCalled();
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private');
  });

  it('atomic claims and expired leases prevent stale acknowledgement and recover exhausted leases', async () => {
    await service.enqueueInvitation(invitation);
    const now = new Date(Date.now() + 1_000);
    const claims = await Promise.allSettled(
      Array.from({ length: 8 }, () => service.claim(now)),
    );
    const winners = claims.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    );
    expect(winners).toHaveLength(1);
    const original = winners[0];
    await service.recoverExpired(new Date(now.getTime() + 120_001));
    const newer = await service.claim(new Date(now.getTime() + 120_002));
    expect(newer).not.toBeNull();
    await expect(service.finish(original, new Date())).rejects.toThrow(
      /lease lost/,
    );
    expect(await deliveries.findOne().lean()).toMatchObject({
      status: 'sending',
      leaseToken: newer?.leaseToken,
    });
    await deliveries.updateMany(
      {},
      { $set: { attempts: 5, leaseExpiresAt: new Date(0) } },
    );
    await service.recoverExpired(new Date());
    expect(await deliveries.findOne().lean()).toMatchObject({
      status: 'failed',
      lastError: 'attempts_exhausted',
    });
  });

  it('rolls back the notification if email enqueue fails and reports the failure explicitly', async () => {
    const failure = vi
      .spyOn(service, 'enqueueNotification')
      .mockRejectedValueOnce(new Error('write failed'));
    await emitter.emitAsync(Events.FlightBookingConfirmed, booking);
    expect(await notifications.countDocuments()).toBe(0);
    expect(await deliveries.countDocuments()).toBe(0);
    expect(logs).toHaveBeenCalled();
    failure.mockRestore();
  });

  it('logs malformed invitations, missing notification and unexpected SMTP failures', async () => {
    await emitter.emitAsync(Events.ModeratorInvited, {
      userId: 'bad',
      eventId: '',
    });
    expect(await deliveries.countDocuments()).toBe(0);
    expect(logs).toHaveBeenCalled();
    await emitter.emitAsync(Events.FlightBookingConfirmed, booking);
    await notifications.deleteMany({});
    await worker.processDue();
    expect(await deliveries.findOne().lean()).toMatchObject({
      status: 'failed',
      lastError: 'notification_missing',
    });
    await service.enqueueInvitation(invitation);
    send.mockRejectedValueOnce(new Error('sensitive SMTP reply'));
    await worker.processDue();
    expect(
      await deliveries.findOne({ kind: 'moderator_invitation' }).lean(),
    ).toMatchObject({ status: 'pending', lastError: 'smtp_unknown' });
    expect(JSON.stringify(logs.mock.calls)).not.toContain('sensitive');
  });

  it('retains the lease on failed acknowledgement after acceptance, allowing the documented possible duplicate', async () => {
    await service.enqueueInvitation(invitation);
    const ack = vi
      .spyOn(service, 'finish')
      .mockRejectedValueOnce(new Error('database acknowledgement unavailable'));
    await worker.processDue();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await deliveries.findOne().lean()).toMatchObject({
      status: 'sending',
    });
    ack.mockRestore();
    await deliveries.updateMany({}, { $set: { leaseExpiresAt: new Date(0) } });
    await worker.processDue();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await deliveries.findOne().lean()).toMatchObject({ status: 'sent' });
  });
});

describe('Disabled email delivery (GEN-01-B)', () => {
  it(
    'preserves in-app notifications without queuing or contacting SMTP',
    async () => {
      const send = vi.fn();
      const t = await createTestApp({
        override: (b) => b.overrideProvider(SmtpMailer).useValue({ send }),
      });
      try {
        await t.moduleRef
          .get(EventEmitter2)
          .emitAsync(Events.FlightBookingConfirmed, booking);
        await t.moduleRef
          .get(EventEmitter2)
          .emitAsync(Events.ModeratorInvited, invitation);
        await t.moduleRef.get(EmailDeliveryWorker).processDue();
        expect(
          await t.connection.model(Notification.name).countDocuments(),
        ).toBe(1);
        expect(
          await t.connection.model(EmailDelivery.name).countDocuments(),
        ).toBe(0);
        expect(send).not.toHaveBeenCalled();
      } finally {
        await t.close();
      }
    },
    HOOK_TIMEOUT,
  );
});
