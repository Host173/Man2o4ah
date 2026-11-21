import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { FakeEmailRecipientLookup } from '../../../test/fakes/email-recipient.fake.js';
import { AccountEmailRecipient } from './account-email-recipient.js';
import { User } from './schemas/user.schema.js';
import { EmailRecipientRegistry } from '../notifications/ports/email-recipient.registry.js';

describe('Accounts email-recipient port (GEN-01-B)', () => {
  let t: TestApp;
  let users: Model<User>;
  beforeAll(async () => {
    t = await createTestApp();
    users = t.moduleRef.get<Model<User>>(getModelToken(User.name));
  }, HOOK_TIMEOUT);
  beforeEach(() => clearCollections(t.connection));
  afterAll(() => t.close(), HOOK_TIMEOUT);

  it.each(['active', 'suspended', 'deactivated'] as const)(
    'returns only the id/email for a %s account via the registered adapter',
    async (status) => {
      const user = await users.create({
        name: 'Example',
        email: 'recipient@example.test',
        passwordHash: 'not-a-real-password',
        status,
      });
      const recipient = await t.moduleRef
        .get(EmailRecipientRegistry)
        .getRecipient(user._id.toString());
      expect(recipient).toEqual({
        userId: user._id.toString(),
        email: user.email,
      });
    },
  );

  it('unknown accounts return null, malformed IDs reject, and storage errors propagate', async () => {
    const adapter = t.moduleRef.get(AccountEmailRecipient);
    await expect(
      adapter.getRecipient(new Types.ObjectId().toHexString()),
    ).resolves.toBeNull();
    await expect(adapter.getRecipient('bad')).rejects.toMatchObject({
      response: { code: 'VALIDATION_FAILED' },
    });
    const failure = vi.spyOn(users, 'findById').mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    await expect(
      adapter.getRecipient(new Types.ObjectId().toHexString()),
    ).rejects.toThrow('database unavailable');
    failure.mockRestore();
  });

  it('the typed fake and registry preserve contract errors and reject duplicate/missing wiring', async () => {
    const id = new Types.ObjectId().toHexString();
    const fake = new FakeEmailRecipientLookup([
      { userId: id, email: 'fake@example.test' },
    ]);
    const registry = new EmailRecipientRegistry();
    expect(() => registry.getRecipient(id)).toThrow(/No EmailRecipientLookup/);
    registry.register(fake);
    expect(() => registry.register(fake)).toThrow(/already registered/);
    await expect(registry.getRecipient(id.toUpperCase())).resolves.toEqual({
      userId: id,
      email: 'fake@example.test',
    });
    await expect(
      registry.getRecipient(new Types.ObjectId().toHexString()),
    ).resolves.toBeNull();
    await expect(registry.getRecipient('bad')).rejects.toMatchObject({
      response: { code: 'VALIDATION_FAILED' },
    });
  });
});
