import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { SMTP_CONFIG } from '../../config/smtp-config.js';
import type { SmtpConfig } from '../../config/smtp-config.js';
import { EmailDeliveryError } from './schemas/email-delivery.schema.js';

export class SmtpDeliveryError extends Error {
  constructor(readonly category: EmailDeliveryError) {
    super(category);
  }
}

export interface EmailMessage {
  deliveryKey: string;
  to: string;
  subject: string;
  text: string;
}

/** GEN-01-B: tests replace this adapter; no credentials or raw SMTP errors escape. */
@Injectable()
export class SmtpMailer {
  private readonly transport?: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(@Inject(SMTP_CONFIG) private readonly config: SmtpConfig) {
    if (config.enabled) {
      this.transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: config.requireTLS,
        auth: config.auth,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 15_000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    }
  }

  async send(message: EmailMessage): Promise<void> {
    const config = this.config;
    if (!config.enabled || !this.transport)
      throw new Error('SMTP delivery is disabled');
    const destination = config.testInbox ?? message.to;
    if (
      !isEmail(destination) ||
      /[\r\n]/.test(destination) ||
      /[\r\n]/.test(message.subject)
    ) {
      throw new SmtpDeliveryError(EmailDeliveryError.SMTP_REJECTED);
    }
    try {
      const result = await this.transport.sendMail({
        from: config.from,
        to: destination,
        envelope: { from: config.from, to: [destination] },
        subject: message.subject,
        text: message.text,
        messageId: `<${createHash('sha256').update(message.deliveryKey).digest('hex')}@${config.from.split('@')[1]}>`,
      });
      if (!result.accepted.includes(destination)) {
        throw new SmtpDeliveryError(EmailDeliveryError.SMTP_REJECTED);
      }
    } catch (error) {
      if (error instanceof SmtpDeliveryError) throw error;
      const code =
        typeof error === 'object' && error !== null && 'responseCode' in error
          ? error.responseCode
          : undefined;
      throw new SmtpDeliveryError(
        typeof code === 'number' && code >= 500
          ? EmailDeliveryError.SMTP_REJECTED
          : EmailDeliveryError.SMTP_TRANSIENT,
      );
    }
  }
}
