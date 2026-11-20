import { Logger } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import type { Model } from 'mongoose';
import {
  HOOK_TIMEOUT,
  startMemoryMongo,
  type MemoryMongo,
} from '../../../../test/support/mongo-memory.js';
import { User, UserRole, UserStatus } from '../schemas/user.schema.js';
import { AccountsSeedModule } from './accounts-seed.module.js';
import { AdminSeedService, SEED_ADMIN_NAME } from './admin-seed.service.js';

const INPUT = { email: 'admin@example.com', password: 'Admin12345' };

// Each run hashes with bcrypt cost 12, so the tests get extra time.
describe('admin seed (ACC-18)', { timeout: 30_000 }, () => {
  let mongo: MemoryMongo;
  let moduleRef: TestingModule;
  let users: Model<User>;
  let seed: AdminSeedService;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.uri, { dbName: 'admin-seed' }),
        AccountsSeedModule,
      ],
    }).compile();
    await moduleRef.init();
    users = moduleRef.get<Model<User>>(getModelToken(User.name));
    // The unique email index must exist before the parallel-run test.
    await users.init();
    seed = moduleRef.get(AdminSeedService);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await users.deleteMany({});
  });

  async function storedHash(): Promise<string> {
    const user = await users
      .findOne({ email: INPUT.email })
      .select('+passwordHash')
      .lean();
    if (!user) throw new Error('no account with the seed email');
    return user.passwordHash;
  }

  it('creates one active admin with a bcrypt hash of the password', async () => {
    const result = await seed.run(INPUT);

    expect(result.status).toBe('created');
    const all = await users.find().lean();
    expect(all).toHaveLength(1);
    expect(all[0]._id.toString()).toBe(result.userId);
    expect(all[0]).toMatchObject({
      name: SEED_ADMIN_NAME,
      email: INPUT.email,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      failedLoginAttempts: 0,
    });
    const hash = await storedHash();
    expect(hash).not.toBe(INPUT.password);
    expect(await bcrypt.compare(INPUT.password, hash)).toBe(true);
  });

  it('running it twice leaves exactly one admin and changes nothing', async () => {
    const first = await seed.run(INPUT);
    const before = await users
      .findById(first.userId)
      .select('+passwordHash')
      .lean();

    const second = await seed.run(INPUT);

    expect(second).toEqual({ status: 'unchanged', userId: first.userId });
    expect(await users.countDocuments()).toBe(1);
    expect(await users.countDocuments({ role: UserRole.ADMIN })).toBe(1);
    const after = await users
      .findById(first.userId)
      .select('+passwordHash')
      .lean();
    expect(after).toEqual(before);
  });

  it('a re-run with another password keeps the original password', async () => {
    await seed.run(INPUT);

    await seed.run({ ...INPUT, password: 'Different123' });

    expect(await bcrypt.compare(INPUT.password, await storedHash())).toBe(true);
  });

  it('refuses an email that belongs to a non-admin and changes nothing', async () => {
    await users.create({
      name: 'Traveler',
      email: INPUT.email,
      passwordHash: 'existing-hash',
      role: UserRole.USER,
    });

    await expect(seed.run(INPUT)).rejects.toThrow(
      /already registered with role "user"/,
    );
    expect(await users.countDocuments({ role: UserRole.ADMIN })).toBe(0);
    expect(await storedHash()).toBe('existing-hash');
  });

  it('two runs at the same time still create exactly one admin', async () => {
    const results = await Promise.all([seed.run(INPUT), seed.run(INPUT)]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'created',
      'unchanged',
    ]);
    expect(results[0].userId).toBe(results[1].userId);
    expect(await users.countDocuments()).toBe(1);
  });
});
