import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { SMTP_CONFIG } from '../../config/smtp-config.js';
import type { SmtpConfig } from '../../config/smtp-config.js';
import { Events } from '../../common/events/events.js';
import type { ModeratorInvitedEvent } from '../../common/events/event-payloads.js';
import { EmailDeliveryService } from './email-delivery.service.js';
import type { EmailDeliveryClaim } from './email-delivery.service.js';
import { EmailRecipientRegistry } from './ports/email-recipient.registry.js';
import { Notification } from './schemas/notification.schema.js';
import {
  EmailDeliveryError,
  EmailDeliveryKind,
} from './schemas/email-delivery.schema.js';
import { SmtpDeliveryError, SmtpMailer } from './smtp-mailer.js';

export const MODERATOR_INVITATION_TEXT =
  'Your moderator account is ready. Sign in with the temporary password provided separately by your administrator. You must change it on first login.';

@Injectable()
export class EmailDeliveryWorker implements OnModuleInit {
  private readonly logger = new Logger(EmailDeliveryWorker.name);
  private running = false;

  constructor(
    @Inject(SMTP_CONFIG) private readonly config: SmtpConfig,
    private readonly deliveries: EmailDeliveryService,
    private readonly recipients: EmailRecipientRegistry,
    private readonly mailer: SmtpMailer,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled)
      this.logger.log('Email delivery is disabled (SMTP_ENABLED)');
  }

  @OnEvent(Events.ModeratorInvited)
  async onModeratorInvited(payload: ModeratorInvitedEvent): Promise<void> {
    if (!this.config.enabled) return;
    try {
      await this.deliveries.enqueueInvitation(payload);
    } catch {
      this.logger.error('Failed to enqueue moderator invitation');
    }
  }

  @Cron('*/30 * * * * *')
  async processDue(): Promise<void> {
    if (!this.config.enabled || this.running) return;
    this.running = true;
    try {
      await this.deliveries.recoverExpired(new Date());
      for (let i = 0; i < 20; i += 1) {
        const claim = await this.deliveries.claim(new Date());
        if (!claim) break;
        await this.deliver(claim);
      }
    } catch {
      this.logger.error(
        'Email queue processing failed; unacknowledged deliveries retain their leases',
      );
    } finally {
      this.running = false;
    }
  }

  private async deliver(claim: EmailDeliveryClaim): Promise<void> {
    let failure: EmailDeliveryError | undefined;
    try {
      let recipient;
      try {
        recipient = await this.recipients.getRecipient(claim.userId);
      } catch {
        throw new SmtpDeliveryError(EmailDeliveryError.RECIPIENT_LOOKUP_FAILED);
      }
      if (!recipient)
        throw new SmtpDeliveryError(EmailDeliveryError.RECIPIENT_MISSING);
      let subject = 'Moderator invitation';
      let text = MODERATOR_INVITATION_TEXT;
      if (claim.kind === EmailDeliveryKind.NOTIFICATION) {
        const notification = await this.notifications
          .findOne({ _id: claim.notificationId, userId: claim.userId })
          .lean();
        if (!notification)
          throw new SmtpDeliveryError(EmailDeliveryError.NOTIFICATION_MISSING);
        subject = notification.title;
        text = notification.message;
      }
      await this.mailer.send({
        deliveryKey: claim.deliveryKey,
        to: recipient.email,
        subject,
        text,
      });
    } catch (error) {
      failure =
        error instanceof SmtpDeliveryError
          ? error.category
          : EmailDeliveryError.SMTP_UNKNOWN;
      this.logger.error(`Email delivery ${claim.id} failed: ${failure}`);
    }
    // An acknowledgement failure must retain the claim: SMTP may already have accepted it.
    await this.deliveries.finish(claim, new Date(), failure);
  }
}
