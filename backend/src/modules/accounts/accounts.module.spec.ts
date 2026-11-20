import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';
import { Session } from './schemas/session.schema.js';
import { User } from './schemas/user.schema.js';

/**
 * Modules that import AccountsModule mock only the accounts models (users,
 * sessions) in their wiring tests. AccountsModule must not need any other
 * module's models to start, or those tests break (ACC-09: ReferenceDataService
 * is looked up from the app at request time, not imported here).
 */
describe('AccountsModule wiring', () => {
  it('compiles with only the users and sessions models mocked', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AccountsModule],
    })
      .useMocker((token) => {
        if (token === getConnectionToken()) return {};
        if (token === ConfigService) {
          return { getOrThrow: () => 'test-secret-with-at-least-32-chars' };
        }
        return undefined;
      })
      .overrideProvider(getModelToken(User.name))
      .useValue({})
      .overrideProvider(getModelToken(Session.name))
      .useValue({})
      .compile();

    expect(moduleRef.get(AccountsService)).toBeInstanceOf(AccountsService);
  });
});
