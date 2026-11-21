import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';
import { Session } from './schemas/session.schema.js';
import { User } from './schemas/user.schema.js';
import { Notification } from '../notifications/schemas/notification.schema.js';
import { EmailDelivery } from '../notifications/schemas/email-delivery.schema.js';

/**
 * GEN-01-B: Accounts imports the notification-owned recipient registry module.
 * Its notification models stay private; all model providers are replaced in
 * this wiring-only test, without starting MongoDB or SMTP.
 */
describe('AccountsModule wiring', () => {
  it('compiles with account and notification model providers mocked', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AccountsModule],
    })
      .useMocker((token) => {
        if (token === getConnectionToken()) return {};
        if (token === ConfigService) {
          return {
            get: () => undefined,
            getOrThrow: () => 'test-secret-with-at-least-32-chars',
          };
        }
        return undefined;
      })
      .overrideProvider(getModelToken(User.name))
      .useValue({})
      .overrideProvider(getModelToken(Session.name))
      .useValue({})
      .overrideProvider(getModelToken(Notification.name))
      .useValue({})
      .overrideProvider(getModelToken(EmailDelivery.name))
      .useValue({})
      .compile();

    expect(moduleRef.get(AccountsService)).toBeInstanceOf(AccountsService);
  });
});
