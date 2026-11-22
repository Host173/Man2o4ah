import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SMTP_CONFIG,
  SMTP_CONFIG_KEYS,
  smtpConfig,
} from '../../config/smtp-config.js';
import {
  EmailDelivery,
  EmailDeliverySchema,
} from './schemas/email-delivery.schema.js';
import { EmailRecipientRegistry } from './ports/email-recipient.registry.js';
import { EmailDeliveryService } from './email-delivery.service.js';
import { EmailDeliveryWorker } from './email-delivery.worker.js';
import { SmtpMailer } from './smtp-mailer.js';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsListener } from './notifications.listener.js';
import { NotificationsService } from './notifications.service.js';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: EmailDelivery.name, schema: EmailDeliverySchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    {
      provide: SMTP_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        smtpConfig(
          Object.fromEntries(
            SMTP_CONFIG_KEYS.map((key) => [key, config.get(key)]),
          ),
        ),
    },
    NotificationsService,
    NotificationsListener,
    EmailRecipientRegistry,
    EmailDeliveryService,
    EmailDeliveryWorker,
    SmtpMailer,
  ],
  exports: [EmailRecipientRegistry],
})
export class NotificationsModule {}
