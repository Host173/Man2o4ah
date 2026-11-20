import { ErrorCode } from '../../../common/errors/error-codes.js';
import { FakeReferenceDataService } from '../../../../test/fakes/reference-data.fake.js';
import { loginAs } from '../../../../test/support/auth.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { ReferenceDataModule } from '../../reference-data/reference-data.module.js';
import { ReferenceDataService } from '../../reference-data/reference-data.service.js';
import { User, UserRole } from '../schemas/user.schema.js';

const URL = '/api/users/me';

describe('/api/users/me (API, ACC-09)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      // As in AppModule: reference data is registered beside accounts.
      imports: [ReferenceDataModule],
      // Supported currencies come from reference data (USD, EGP, AED, EUR, JPY in the fake).
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService()),
    });
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  /** The stored account, to prove what was (not) saved. */
  const stored = (id: string) =>
    t.connection.model(User.name).findById(id).lean<User>();

  describe('GET', () => {
    it('200 with the profile, nothing secret', async () => {
      const u = await loginAs(t.connection, UserRole.USER);
      await t.connection
        .model(User.name)
        .updateOne({ _id: u.id }, { phone: '+20 100 123 4567' });

      const res = await t.http().get(URL).set('Cookie', u.cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        _id: u.id,
        name: 'Test user',
        email: expect.stringContaining('@test.local'),
        role: 'user',
        status: 'active',
        phone: '+20 100 123 4567',
        preferredCurrency: 'USD',
        mustChangePassword: false,
      });
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('failedLoginAttempts');
    });

    it.each([
      UserRole.ADMIN,
      UserRole.AIRLINE_MODERATOR,
      UserRole.HOTEL_MODERATOR,
    ])('200 for any logged-in role (%s)', async (role) => {
      const u = await loginAs(t.connection, role);

      const res = await t.http().get(URL).set('Cookie', u.cookie);

      expect(res.status).toBe(200);
      expect(res.body.role).toBe(role);
      expect(res.body).not.toHaveProperty('phone');
    });

    it('401 NOT_AUTHENTICATED without a cookie', async () => {
      const res = await t.http().get(URL);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
    });
  });

  describe('PATCH', () => {
    it('200 saves name, phone and preferred currency together', async () => {
      const u = await loginAs(t.connection, UserRole.USER);

      const res = await t.http().patch(URL).set('Cookie', u.cookie).send({
        name: '  Aisha Al Rawahi  ',
        phone: ' +968 9123 4567 ',
        preferredCurrency: 'EGP',
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        _id: u.id,
        name: 'Aisha Al Rawahi',
        phone: '+968 9123 4567',
        preferredCurrency: 'EGP',
      });
      expect(await stored(u.id)).toMatchObject({
        name: 'Aisha Al Rawahi',
        phone: '+968 9123 4567',
        preferredCurrency: 'EGP',
      });
    });

    it.each([
      ['one UTF-16 code unit', ' A ', 'A'],
      ['100 UTF-16 code units', ` ${'A'.repeat(100)} `, 'A'.repeat(100)],
      [
        '50 non-BMP letters (100 UTF-16 code units)',
        ` ${'\u{10400}'.repeat(50)} `,
        '\u{10400}'.repeat(50),
      ],
    ])('200 saves a trimmed name of %s', async (_label, input, expected) => {
      const u = await loginAs(t.connection, UserRole.USER);

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ name: input });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(expected);
      expect(await stored(u.id)).toMatchObject({ name: expected });
    });

    it.each([6, 20])('200 saves a phone of %s characters', async (length) => {
      const u = await loginAs(t.connection, UserRole.USER);
      const phone = '1'.repeat(length);

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ phone });

      expect(res.status).toBe(200);
      expect(res.body.phone).toBe(phone);
      expect(await stored(u.id)).toMatchObject({ phone });
    });

    it('rejects a name over 100 UTF-16 code units before checking currency, without saving', async () => {
      const u = await loginAs(t.connection, UserRole.USER);
      const before = await stored(u.id);
      const currencyLookup = vi.spyOn(
        t.moduleRef.get(ReferenceDataService),
        'getCurrency',
      );

      try {
        const res = await t
          .http()
          .patch(URL)
          .set('Cookie', u.cookie)
          .send({
            name: '\u{10400}'.repeat(51),
            phone: '+968 9123 4567',
            preferredCurrency: 'EGP',
          });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
        expect(res.body.details).toEqual([
          { field: 'name', message: expect.any(String) },
        ]);
        expect(await stored(u.id)).toEqual(before);
        expect(currencyLookup).not.toHaveBeenCalled();
      } finally {
        currencyLookup.mockRestore();
      }
    });

    it('200 changes only the fields sent', async () => {
      const u = await loginAs(t.connection, UserRole.HOTEL_MODERATOR);

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ preferredCurrency: 'JPY' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Test hotel_moderator',
        preferredCurrency: 'JPY',
      });
    });

    it('200 removes the phone when it is sent as null', async () => {
      const u = await loginAs(t.connection, UserRole.USER);
      await t.connection
        .model(User.name)
        .updateOne({ _id: u.id }, { phone: '+20 100 123 4567' });

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ phone: null });

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('phone');
      expect(await stored(u.id)).not.toHaveProperty('phone');
    });

    it.each([
      ['an empty name', { name: '' }],
      ['a whitespace-only name', { name: '   ' }],
      ['a name over 100 characters', { name: 'a'.repeat(101) }],
      ['a null name', { name: null }],
      ['a phone in an invalid format', { phone: 'call me' }],
      ['a phone that is too short', { phone: '12345' }],
      ['a phone that is too long', { phone: '1'.repeat(21) }],
      ['a non-string currency', { preferredCurrency: 1 }],
      ['a null currency', { preferredCurrency: null }],
      ['a field that is not editable', { email: 'new@test.local' }],
      ['a role', { role: 'admin' }],
    ])(
      '400 VALIDATION_FAILED for %s, and nothing is saved',
      async (_label, invalid) => {
        const u = await loginAs(t.connection, UserRole.USER);
        const before = await stored(u.id);

        const res = await t
          .http()
          .patch(URL)
          .set('Cookie', u.cookie)
          .send({ name: 'New Name', preferredCurrency: 'EUR', ...invalid });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
        expect(await stored(u.id)).toEqual(before);
      },
    );

    it.each(['XYZ', 'usd', 'GBP'])(
      '400 UNSUPPORTED_CURRENCY for %s, and the other fields are not saved',
      async (currency) => {
        const u = await loginAs(t.connection, UserRole.USER);
        const before = await stored(u.id);

        const res = await t.http().patch(URL).set('Cookie', u.cookie).send({
          name: 'New Name',
          phone: '+20 100 123 4567',
          preferredCurrency: currency,
        });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.UnsupportedCurrency);
        expect(res.body.details).toEqual([
          { field: 'preferredCurrency', message: expect.any(String) },
        ]);
        expect(await stored(u.id)).toEqual(before);
      },
    );

    it('401 NOT_AUTHENTICATED without a cookie', async () => {
      const res = await t.http().patch(URL).send({ name: 'New Name' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
    });

    it('403 PASSWORD_CHANGE_REQUIRED while the password must be changed', async () => {
      const u = await loginAs(t.connection, UserRole.USER, {
        mustChangePassword: true,
      });

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ name: 'New Name' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ErrorCode.PasswordChangeRequired);
    });
  });
});
