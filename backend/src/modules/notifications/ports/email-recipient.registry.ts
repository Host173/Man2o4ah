import { Injectable } from '@nestjs/common';
import type { EmailRecipientLookup } from './email-recipient.port.js';

/** GEN-01-B: Accounts registers its adapter; notifications never imports it. */
@Injectable()
export class EmailRecipientRegistry {
  private lookup?: EmailRecipientLookup;

  register(lookup: EmailRecipientLookup): void {
    if (this.lookup)
      throw new Error('EmailRecipientLookup is already registered');
    this.lookup = lookup;
  }

  getRecipient(userId: string) {
    if (!this.lookup) throw new Error('No EmailRecipientLookup is registered');
    return this.lookup.getRecipient(userId);
  }
}
