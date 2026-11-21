/** GEN-01-B: the only account data needed to address an email. */
export interface EmailRecipient {
  userId: string;
  email: string;
}

export interface EmailRecipientLookup {
  /**
   * Unknown account: null; malformed ID: 400 VALIDATION_FAILED.
   * Suspended/deactivated accounts remain eligible. Storage errors reject.
   */
  getRecipient(userId: string): Promise<EmailRecipient | null>;
}
