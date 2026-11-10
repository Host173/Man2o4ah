import { Schema } from 'mongoose';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

const nameSchema = new Schema<{ name: string }>({ name: String });
const defineNameModel = (db: TestDatabase, name: string, collection: string) =>
  db.connection.model(name, nameSchema, collection);

describe('in-memory test database', () => {
  let db: TestDatabase;
  let alpha: ReturnType<typeof defineNameModel>;
  let beta: ReturnType<typeof defineNameModel>;

  beforeAll(async () => {
    db = await startTestDatabase('transactions');
    alpha = defineNameModel(db, 'Alpha', 'alphas');
    beta = defineNameModel(db, 'Beta', 'betas');
    await alpha.createCollection();
    await beta.createCollection();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await alpha.deleteMany({});
    await beta.deleteMany({});
  });

  it('commits a transaction that writes to two collections', async () => {
    const session = await db.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await alpha.create([{ name: 'a' }], { session });
        await beta.create([{ name: 'b' }], { session });
      });
    } finally {
      await session.endSession();
    }
    expect(await alpha.countDocuments()).toBe(1);
    expect(await beta.countDocuments()).toBe(1);
  });

  it('aborts a transaction and leaves both collections empty', async () => {
    const session = await db.connection.startSession();
    try {
      await expect(
        session.withTransaction(async () => {
          await alpha.create([{ name: 'a' }], { session });
          await beta.create([{ name: 'b' }], { session });
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
    } finally {
      await session.endSession();
    }
    expect(await alpha.countDocuments()).toBe(0);
    expect(await beta.countDocuments()).toBe(0);
  });
});
