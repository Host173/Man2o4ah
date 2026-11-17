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
    expect(created.body.id).toMatch(/^[0-9a-f]{24}$/);

    const profile = await testApp!
      .http()
      .get(`/api/airlines/${created.body.id}`);
    expect(profile.status).toBe(200);
    expect(profile.body).toEqual(created.body);

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
});
