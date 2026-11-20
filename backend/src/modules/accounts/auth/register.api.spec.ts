import bcrypt from 'bcrypt';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { User } from '../schemas/user.schema.js';

const URL = '/api/auth/register';

const valid = {
  name: 'Aisha',
  email: 'aisha@example.com',
  password: 'abcdefg1',
  acceptTerms: true,
};

describe('POST /api/auth/register (API, ACC-01, GEN-13)', () => {
  let t: TestApp;
  let users: Model<User>;

  beforeAll(async () => {
    // AccountsModule (with the global guards) is always part of the test app.
    t = await createTestApp();
    users = t.connection.model<User>(User.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  const expectError = (
    res: { status: number; body: Record<string, unknown> },
    status: number,
    code: ErrorCode,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ statusCode: status, code });
  };

  describe('success', () => {
    it('201 for a guest (no cookie) with the account in the response', async () => {
      const res = await t.http().post(URL).send(valid);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        user: {
          _id: expect.stringMatching(/^[0-9a-f]{24}$/),
          name: 'Aisha',
          email: 'aisha@example.com',
          role: 'user',
          status: 'active',
          preferredCurrency: 'USD',
          mustChangePassword: false,
        },
      });
    });

    it('201 for a 72-character password (the bcrypt limit)', async () => {
      const password = `${'a'.repeat(71)}1`;

      const res = await t
        .http()
        .post(URL)
        .send({ ...valid, password });

      expect(res.status).toBe(201);
      const stored = await users.findOne().select('+passwordHash').lean();
      expect(await bcrypt.compare(password, stored?.passwordHash ?? '')).toBe(
        true,
      );
    });

    it('never returns the password or its hash', async () => {
      const res = await t.http().post(URL).send(valid);

      expect(res.status).toBe(201);
      expect(JSON.stringify(res.body)).not.toContain(valid.password);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain('$2b$');
    });

    it('does not log the user in (no cookies are set)', async () => {
      const res = await t.http().post(URL).send(valid);

      expect(res.status).toBe(201);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('stores role user, status active, consent time and a trimmed, lowercased email', async () => {
      const before = Date.now();
      await t
        .http()
        .post(URL)
        .send({ ...valid, name: '  Aisha  ', email: ' Aisha@Example.COM ' })
        .expect(201);
      const after = Date.now();

      const stored = await users.findOne().lean();
      expect(stored).toMatchObject({
        name: 'Aisha',
        email: 'aisha@example.com',
        role: 'user',
        status: 'active',
        mustChangePassword: false,
        failedLoginAttempts: 0,
      });
      const acceptedAt = stored?.termsAcceptedAt?.getTime() ?? 0;
      expect(acceptedAt).toBeGreaterThanOrEqual(before);
      expect(acceptedAt).toBeLessThanOrEqual(after);
    });

    it('stores only a salted bcrypt hash (cost 12), hidden by default', async () => {
      await t.http().post(URL).send(valid).expect(201);

      const hidden = await users.findOne().lean();
      expect(hidden).not.toHaveProperty('passwordHash');

      const stored = await users.findOne().select('+passwordHash').lean();
      const hash = stored?.passwordHash ?? '';
      expect(hash).not.toBe(valid.password);
      expect(hash).toMatch(/^\$2b\$12\$/);
      expect(await bcrypt.compare(valid.password, hash)).toBe(true);
    });

    it('salts each hash: the same password gives different hashes', async () => {
      await t.http().post(URL).send(valid).expect(201);
      await t
        .http()
        .post(URL)
        .send({ ...valid, email: 'other@example.com' })
        .expect(201);

      const stored = await users.find().select('+passwordHash').lean();
      expect(stored).toHaveLength(2);
      expect(stored[0].passwordHash).not.toBe(stored[1].passwordHash);
    });
  });

  describe('duplicate email (409 EMAIL_TAKEN)', () => {
    it('rejects an email that is already registered', async () => {
      await t.http().post(URL).send(valid).expect(201);

      const res = await t.http().post(URL).send(valid);

      expectError(res, 409, ErrorCode.EmailTaken);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'email' }),
      ]);
      expect(await users.countDocuments()).toBe(1);
    });

    it('treats emails that differ only in case and spaces as the same', async () => {
      await t.http().post(URL).send(valid).expect(201);

      const res = await t
        .http()
        .post(URL)
        .send({ ...valid, email: '  AISHA@example.com ' });

      expectError(res, 409, ErrorCode.EmailTaken);
      expect(await users.countDocuments()).toBe(1);
    });

    it('lets exactly one of two parallel registrations with the same email succeed', async () => {
      const results = await Promise.all([
        t.http().post(URL).send(valid),
        t.http().post(URL).send(valid),
      ]);

      const statuses = results.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409);
      expect(loser?.body.code).toBe(ErrorCode.EmailTaken);
      expect(await users.countDocuments()).toBe(1);
    });
  });

  describe('validation (400 VALIDATION_FAILED, field in details)', () => {
    it.each([
      ['an invalid email', { email: 'not-an-email' }, 'email'],
      ['a missing email', { email: undefined }, 'email'],
      ['a 7-character password', { password: 'abcdef1' }, 'password'],
      [
        'a 73-character password',
        { password: `${'a'.repeat(72)}1` },
        'password',
      ],
      ['a password without a digit', { password: 'abcdefgh' }, 'password'],
      ['a password without a letter', { password: '12345678' }, 'password'],
      ['missing consent', { acceptTerms: undefined }, 'acceptTerms'],
      ['consent set to false', { acceptTerms: false }, 'acceptTerms'],
      ['an empty name', { name: '   ' }, 'name'],
      ['a 101-character name', { name: 'a'.repeat(101) }, 'name'],
    ])('rejects %s', async (_case, change, field) => {
      const res = await t
        .http()
        .post(URL)
        .send({ ...valid, ...change });

      expectError(res, 400, ErrorCode.ValidationFailed);
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
      expect(await users.countDocuments()).toBe(0);
    });

    it('rejects an email the stored format refuses, without saving', async () => {
      const res = await t
        .http()
        .post(URL)
        .send({ ...valid, email: 'aïsha@example.com' });

      expectError(res, 400, ErrorCode.ValidationFailed);
      expect(await users.countDocuments()).toBe(0);
    });

    it('rejects an empty body with every field listed', async () => {
      const res = await t.http().post(URL).send({});

      expectError(res, 400, ErrorCode.ValidationFailed);
      const fields = (res.body.details as { field: string }[]).map(
        (d) => d.field,
      );
      expect(fields).toEqual(
        expect.arrayContaining(['name', 'email', 'password', 'acceptTerms']),
      );
    });

    it.each([
      ['role', 'admin'],
      ['status', 'active'],
      ['mustChangePassword', false],
    ])(
      'rejects a client-supplied %s and creates nothing',
      async (field, value) => {
        const res = await t
          .http()
          .post(URL)
          .send({ ...valid, [field]: value });

        expectError(res, 400, ErrorCode.ValidationFailed);
        expect(await users.countDocuments()).toBe(0);
      },
    );
  });
});
