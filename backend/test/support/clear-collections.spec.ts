import { Session } from '../../src/modules/accounts/schemas/session.schema.js';
import {
  User,
  UserRole,
} from '../../src/modules/accounts/schemas/user.schema.js';
import { loginAs } from './auth.js';
import { clearCollections } from './clear-collections.js';
import { HOOK_TIMEOUT, startTestDatabase } from './mongo-memory.js';
import type { TestDatabase } from './mongo-memory.js';

describe('clearCollections', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, HOOK_TIMEOUT);

  afterAll(() => db.stop(), HOOK_TIMEOUT);

  it('empties every collection and keeps the indexes', async () => {
    await loginAs(db.connection, UserRole.USER); // fills users and sessions
    const users = db.connection.collection('users');
    const sessions = db.connection.collection('sessions');
    expect(await users.countDocuments()).toBe(1);
    expect(await sessions.countDocuments()).toBe(1);

    await clearCollections(db.connection);

    expect(await users.countDocuments()).toBe(0);
    expect(await sessions.countDocuments()).toBe(0);
    const indexes = await users.indexes();
    expect(indexes.some((index) => index.unique && index.key.email === 1)).toBe(
      true,
    );
    expect(db.connection.models[User.name]).toBeDefined();
    expect(db.connection.models[Session.name]).toBeDefined();
  });
});
