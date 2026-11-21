import { BadRequestException } from '@nestjs/common';
import type { AccountEmailRecipient } from '../../src/modules/accounts/account-email-recipient.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type { EmailRecipient } from '../../src/modules/notifications/ports/email-recipient.port.js';
import type { PublicApi } from './public-api.js';

export class FakeEmailRecipientLookup implements PublicApi<AccountEmailRecipient> {
  constructor(private readonly recipients: EmailRecipient[] = []) {}

  onModuleInit(): void {}

  async getRecipient(userId: string): Promise<EmailRecipient | null> {
    if (!/^[0-9a-f]{24}$/i.test(userId)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid email recipient id',
      });
    }
    const recipient = this.recipients.find(
      (item) => item.userId === userId.toLowerCase(),
    );
    return recipient ? { ...recipient } : null;
  }
}
