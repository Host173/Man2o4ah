import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { StorageService } from '../storage/storage.service.js';
import { AirlinesService } from './airlines.service.js';
import { FlightsModule } from './flights.module.js';

describe('AirlinesController HTTP API (FLT-01)', () => {
  let testApp: TestApp | undefined;
  let storage: FakeStorageService;
  let airlines: AirlinesService;

  beforeAll(async () => {
    storage = new FakeStorageService();
    testApp = await createTestApp({
      imports: [FlightsModule],
      override: (builder) =>
        builder.overrideProvider(StorageService).useValue(storage),
    });
    airlines = testApp.moduleRef.get(AirlinesService);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    if (testApp) await clearCollections(testApp.connection);
    await Promise.all(storage.keys().map((key) => storage.delete(key)));
  });

  afterAll(async () => {
    await testApp?.close();
  }, HOOK_TIMEOUT);

  it('registers the airline profile routes in Swagger', () => {
    const document = SwaggerModule.createDocument(
      testApp!.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .build(),
    );

    expect(document.paths['/api/airlines']?.post).toBeDefined();
    expect(document.paths['/api/airlines/{id}']?.get).toBeDefined();
    expect(document.paths['/api/airlines/{id}']?.patch).toBeDefined();
    expect(document.paths['/api/airlines/{id}/logo']?.post).toBeDefined();
    expect(
      document.paths['/api/airlines/{id}/baggage-policy']?.put,
    ).toBeDefined();
    expect(
      document.paths['/api/airlines/{id}/cancellation-policy']?.put,
    ).toBeDefined();
    expect(
      document.paths['/api/airlines/{id}/cancellation-policy']?.put
        ?.requestBody,
    ).toMatchObject({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/UpdateAirlineCancellationPolicyDto',
          },
        },
      },
    });
    expect(document.components?.schemas?.AirlineResponseDto).toMatchObject({
      properties: {
        _id: { type: 'string' },
        cancellationTiers: {
          type: 'array',
          items: {
            $ref: '#/components/schemas/CancellationTierResponseDto',
          },
        },
      },
    });
    expect(document.components?.schemas?.AirlineResponseDto).not.toHaveProperty(
      'properties.id',
    );
    expect(document.paths['/api/airlines/{id}']?.patch?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'string' },
        }),
      ]),
    );
  });

  it('allows admins to create an airline and exposes its public profile', async () => {
    const admin = await loginAs(testApp!.connection, UserRole.ADMIN);
    const created = await testApp!
      .http()
      .post('/api/airlines')
      .set('Cookie', admin.cookie)
      .send({ name: '  Cairo Air  ', code: 'ca' });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Cairo Air',
      code: 'CA',
      isActive: true,
      baggagePolicy: {
        extraBagPriceMinor: null,
        maxExtraBagsPerPassenger: 0,
      },
      cancellationTiers: [],
    });
    expect(created.body._id).toMatch(/^[0-9a-f]{24}$/);
    expect(created.body).not.toHaveProperty('id');

    const profile = await testApp!
      .http()
      .get(`/api/airlines/${created.body._id}`);
    expect(profile.status).toBe(200);
    expect(profile.body).toEqual(created.body);

    const unknown = await testApp!
      .http()
      .get(`/api/airlines/${new Types.ObjectId().toHexString()}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe(ErrorCode.NotFound);

    const duplicate = await testApp!
      .http()
      .post('/api/airlines')
      .set('Cookie', admin.cookie)
      .send({ name: 'Duplicate Airline', code: 'CA' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe(ErrorCode.Conflict);
  });

  it('requires admin for creation and validates profile data', async () => {
    const user = await loginAs(testApp!.connection, UserRole.USER);
    const unauthenticated = await testApp!
      .http()
      .post('/api/airlines')
      .send({ name: 'Cairo Air', code: 'CA' });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe(ErrorCode.NotAuthenticated);

    const forbidden = await testApp!
      .http()
      .post('/api/airlines')
      .set('Cookie', user.cookie)
      .send({ name: 'Cairo Air', code: 'CA' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe(ErrorCode.ForbiddenRole);

    const admin = await loginAs(testApp!.connection, UserRole.ADMIN);
    const invalid = await testApp!
      .http()
      .post('/api/airlines')
      .set('Cookie', admin.cookie)
      .send({ name: '   ', code: 'bad-code' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it('allows a moderator to edit only their own airline profile', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const moderator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      {
        providerId: airline.id,
      },
    );
    const updated = await testApp!
      .http()
      .patch(`/api/airlines/${airline.id}`)
      .set('Cookie', moderator.cookie)
      .send({ name: 'Nile Air', code: 'na' });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Nile Air', code: 'NA' });
    expect(updated.body._id).toBe(airline.id);
    expect(updated.body).not.toHaveProperty('id');

    const unauthenticated = await testApp!
      .http()
      .patch(`/api/airlines/${airline.id}`)
      .send({ name: 'Not logged in' });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe(ErrorCode.NotAuthenticated);

    const anotherModerator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: new Types.ObjectId().toHexString() },
    );
    const hidden = await testApp!
      .http()
      .patch(`/api/airlines/${airline.id}`)
      .set('Cookie', anotherModerator.cookie)
      .send({ name: 'Unauthorized Edit' });
    expect(hidden.status).toBe(404);
    expect(hidden.body.code).toBe(ErrorCode.NotFound);

    const statusChange = await testApp!
      .http()
      .patch(`/api/airlines/${airline.id}`)
      .set('Cookie', moderator.cookie)
      .send({ isActive: false });
    expect(statusChange.status).toBe(400);
    expect(statusChange.body.code).toBe(ErrorCode.ValidationFailed);

    const regularUser = await loginAs(testApp!.connection, UserRole.USER);
    const wrongRole = await testApp!
      .http()
      .patch(`/api/airlines/${airline.id}`)
      .set('Cookie', regularUser.cookie)
      .send({ name: 'Not a moderator' });
    expect(wrongRole.status).toBe(403);
    expect(wrongRole.body.code).toBe(ErrorCode.ForbiddenRole);
  });

  it('accepts a moderator logo upload and rejects a missing file', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const moderator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      {
        providerId: airline.id,
      },
    );
    const uploaded = await testApp!
      .http()
      .post(`/api/airlines/${airline.id}/logo`)
      .set('Cookie', moderator.cookie)
      .attach('file', Buffer.from('logo image'), {
        filename: 'logo.png',
        contentType: 'image/png',
      });

    expect(uploaded.status).toBe(201);
    expect(uploaded.body._id).toBe(airline.id);
    expect(uploaded.body).not.toHaveProperty('id');
    expect(uploaded.body.logo).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      url: expect.stringMatching(/^\/uploads\//),
    });

    const missing = await testApp!
      .http()
      .post(`/api/airlines/${airline.id}/logo`)
      .set('Cookie', moderator.cookie);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it('rejects duplicate airline codes when a moderator edits a profile', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    await airlines.create({ name: 'Nile Air', code: 'NA' });
    const moderator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: airline.id },
    );

    const duplicate = await testApp!
      .http()
      .patch(`/api/airlines/${airline.id}`)
      .set('Cookie', moderator.cookie)
      .send({ code: 'na' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe(ErrorCode.Conflict);
  });

  it('scopes logo upload to the assigned airline and requires a moderator login', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const anotherModerator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: new Types.ObjectId().toHexString() },
    );
    const logo = () =>
      testApp!
        .http()
        .post(`/api/airlines/${airline.id}/logo`)
        .attach('file', Buffer.from('logo image'), {
          filename: 'logo.png',
          contentType: 'image/png',
        });

    const hidden = await logo().set('Cookie', anotherModerator.cookie);
    expect(hidden.status).toBe(404);
    expect(hidden.body.code).toBe(ErrorCode.NotFound);

    const unauthenticated = await logo();
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe(ErrorCode.NotAuthenticated);

    const regularUser = await loginAs(testApp!.connection, UserRole.USER);
    const wrongRole = await logo().set('Cookie', regularUser.cookie);
    expect(wrongRole.status).toBe(403);
    expect(wrongRole.body.code).toBe(ErrorCode.ForbiddenRole);
    expect(storage.keys()).toHaveLength(0);
  });

  it('keeps only the final logo after parallel replacements', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const moderator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: airline.id },
    );

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        testApp!
          .http()
          .post(`/api/airlines/${airline.id}/logo`)
          .set('Cookie', moderator.cookie)
          .attach('file', Buffer.from(`logo image ${index}`), {
            filename: `logo-${index}.png`,
            contentType: 'image/png',
          }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201, 201, 201,
    ]);

    const current = await airlines.getAirline(airline.id);
    const currentKey = current?.logo?.url.replace('/uploads/', '');
    expect(currentKey).toBeDefined();
    expect(storage.keys()).toEqual([currentKey]);
    expect(storage.has(currentKey!)).toBe(true);
  });

  it('replaces baggage policy and accepts the defined boundary values', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const moderator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: airline.id },
    );
    const path = `/api/airlines/${airline.id}/baggage-policy`;

    const minimum = await testApp!
      .http()
      .put(path)
      .set('Cookie', moderator.cookie)
      .send({ extraBagPriceMinor: 1, maxExtraBagsPerPassenger: 1 })
      .expect(200);
    expect(minimum.body).toMatchObject({
      baggagePolicy: {
        extraBagPriceMinor: 1,
        maxExtraBagsPerPassenger: 1,
      },
      cancellationTiers: [],
    });
    expect(minimum.body._id).toBe(airline.id);
    expect(minimum.body).not.toHaveProperty('id');

    const disabled = await testApp!
      .http()
      .put(path)
      .set('Cookie', moderator.cookie)
      .send({ extraBagPriceMinor: null, maxExtraBagsPerPassenger: 0 })
      .expect(200);
    expect(disabled.body.baggagePolicy).toEqual({
      extraBagPriceMinor: null,
      maxExtraBagsPerPassenger: 0,
    });

    const large = await testApp!
      .http()
      .put(path)
      .set('Cookie', moderator.cookie)
      .send({
        extraBagPriceMinor: Number.MAX_SAFE_INTEGER,
        maxExtraBagsPerPassenger: Number.MAX_SAFE_INTEGER,
      })
      .expect(200);
    expect(large.body.baggagePolicy).toEqual({
      extraBagPriceMinor: Number.MAX_SAFE_INTEGER,
      maxExtraBagsPerPassenger: Number.MAX_SAFE_INTEGER,
    });
  });

  it('rejects invalid baggage policy boundaries without changing the saved policy', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const moderator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: airline.id },
    );
    const path = `/api/airlines/${airline.id}/baggage-policy`;
    const invalidPolicies = [
      { extraBagPriceMinor: 0, maxExtraBagsPerPassenger: 0 },
      { extraBagPriceMinor: -1, maxExtraBagsPerPassenger: 1 },
      { extraBagPriceMinor: 1.5, maxExtraBagsPerPassenger: 1 },
      {
        extraBagPriceMinor: Number.MAX_SAFE_INTEGER + 1,
        maxExtraBagsPerPassenger: 1,
      },
      { extraBagPriceMinor: null, maxExtraBagsPerPassenger: 1 },
      { maxExtraBagsPerPassenger: 0 },
      { extraBagPriceMinor: 1 },
      { extraBagPriceMinor: null, maxExtraBagsPerPassenger: -1 },
      { extraBagPriceMinor: 1, maxExtraBagsPerPassenger: 1.5 },
      {
        extraBagPriceMinor: 1,
        maxExtraBagsPerPassenger: Number.MAX_SAFE_INTEGER + 1,
      },
    ];

    for (const policy of invalidPolicies) {
      const response = await testApp!
        .http()
        .put(path)
        .set('Cookie', moderator.cookie)
        .send(policy)
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    }

    await expect(airlines.getAirline(airline.id)).resolves.toMatchObject({
      baggagePolicy: {
        extraBagPriceMinor: null,
        maxExtraBagsPerPassenger: 0,
      },
    });
  });

  it('replaces cancellation tiers and accepts zero, 100 percent, and empty policies', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const moderator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: airline.id },
    );
    const path = `/api/airlines/${airline.id}/cancellation-policy`;

    const response = await testApp!
      .http()
      .put(path)
      .set('Cookie', moderator.cookie)
      .send({
        tiers: [
          { daysBefore: 0, refundPercent: 0 },
          { daysBefore: Number.MAX_SAFE_INTEGER, refundPercent: 100 },
        ],
      })
      .expect(200);
    expect(response.body.cancellationTiers).toEqual([
      { daysBefore: 0, refundPercent: 0 },
      { daysBefore: Number.MAX_SAFE_INTEGER, refundPercent: 100 },
    ]);
    expect(response.body._id).toBe(airline.id);
    expect(response.body).not.toHaveProperty('id');

    const cleared = await testApp!
      .http()
      .put(path)
      .set('Cookie', moderator.cookie)
      .send({ tiers: [] })
      .expect(200);
    expect(cleared.body.cancellationTiers).toEqual([]);
  });

  it('rejects invalid cancellation tier boundaries without changing the saved tiers', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const moderator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: airline.id },
    );
    const path = `/api/airlines/${airline.id}/cancellation-policy`;
    const invalidPolicies = [
      {
        tiers: [
          { daysBefore: 0, refundPercent: 0 },
          { daysBefore: 0, refundPercent: 100 },
        ],
      },
      { tiers: [{ daysBefore: -1, refundPercent: 50 }] },
      { tiers: [{ daysBefore: 1.5, refundPercent: 50 }] },
      {
        tiers: [{ daysBefore: Number.MAX_SAFE_INTEGER + 1, refundPercent: 50 }],
      },
      { tiers: [{ daysBefore: 1, refundPercent: -1 }] },
      { tiers: [{ daysBefore: 1, refundPercent: 101 }] },
      { tiers: [{ daysBefore: 1, refundPercent: 50.5 }] },
      { tiers: [{ daysBefore: 1 }] },
      { tiers: [{ refundPercent: 50 }] },
      { tiers: null },
      {},
    ];

    for (const policy of invalidPolicies) {
      const response = await testApp!
        .http()
        .put(path)
        .set('Cookie', moderator.cookie)
        .send(policy)
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    }

    await expect(airlines.getAirline(airline.id)).resolves.toMatchObject({
      cancellationTiers: [],
    });
  });

  it('requires an assigned airline moderator to change either policy', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const otherModerator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: new Types.ObjectId().toHexString() },
    );
    const regularUser = await loginAs(testApp!.connection, UserRole.USER);
    const requests = [
      {
        path: `/api/airlines/${airline.id}/baggage-policy`,
        body: { extraBagPriceMinor: 1, maxExtraBagsPerPassenger: 1 },
      },
      {
        path: `/api/airlines/${airline.id}/cancellation-policy`,
        body: { tiers: [] },
      },
    ];

    for (const { path, body } of requests) {
      await testApp!.http().put(path).send(body).expect(401);
      await testApp!
        .http()
        .put(path)
        .set('Cookie', regularUser.cookie)
        .send(body)
        .expect(403);
      const hidden = await testApp!
        .http()
        .put(path)
        .set('Cookie', otherModerator.cookie)
        .send(body)
        .expect(404);
      expect(hidden.body.code).toBe(ErrorCode.NotFound);
    }
  });
});
