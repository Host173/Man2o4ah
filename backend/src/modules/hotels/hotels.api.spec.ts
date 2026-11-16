import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Role } from '../accounts/auth/auth.types.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { HotelsModule } from './hotels.module.js';
import { HotelsService } from './hotels.service.js';
import { Hotel } from './schemas/hotel.schema.js';

const profile = {
  name: 'Nile View Hotel',
  address: '1 Corniche El Nil',
  cityId: 'cairo',
  description: 'A hotel by the Nile',
  starRating: 4,
  amenities: ['Wi-Fi', 'Pool'],
};

describe('Hotel profile API (HTL-01)', () => {
  let t: TestApp;
  let service: HotelsService;
  let hotels: Model<Hotel>;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService()),
    });
    service = t.moduleRef.get(HotelsService);
    hotels = t.moduleRef.get<Model<Hotel>>(getModelToken(Hotel.name));
  }, HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));
  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('allows an admin to create a hotel and returns only the documented profile fields', async () => {
    const admin = await loginAs(t.connection, Role.ADMIN);
    const response = await t
      .http()
      .post('/api/hotels')
      .set('Cookie', admin.cookie)
      .send({ ...profile, name: '  Nile View Hotel  ' })
      .expect(201);
    expect(response.body).toEqual({
      ...profile,
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      countryCode: 'EG',
      photos: [],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationPolicy: { tiers: [] },
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    });
    expect(await service.getHotel(response.body.id)).toEqual(response.body);
    expect(await hotels.countDocuments()).toBe(1);
  });

  it('uses the authenticated moderator assignment for a partial edit', async () => {
    const created = await service.create(profile);
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    const response = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', moderator.cookie)
      .send({ name: '  Dubai View  ', cityId: 'dubai' })
      .expect(200);
    expect(response.body).toEqual({
      ...created,
      name: 'Dubai View',
      cityId: 'dubai',
      countryCode: 'AE',
    });
    expect(await service.getHotel(created.id)).toEqual(response.body);
  });

  it('computes photo URLs in HTTP responses without changing the stored or internal view', async () => {
    const created = await service.create(profile);
    const photoId = new Types.ObjectId();
    await hotels.updateOne(
      { _id: created.id },
      { $set: { photos: [{ _id: photoId, key: 'hotel.jpg' }] } },
    );
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    const response = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', moderator.cookie)
      .send({ description: '' })
      .expect(200);
    expect(response.body.photos).toEqual([
      {
        id: photoId.toHexString(),
        key: 'hotel.jpg',
        url: '/uploads/hotel.jpg',
      },
    ]);
    expect((await service.getHotel(created.id))?.photos).toEqual([
      { id: photoId.toHexString(), key: 'hotel.jpg' },
    ]);
    expect(
      (await hotels.findById(created.id).lean().exec())?.photos[0],
    ).not.toHaveProperty('url');
  });

  it('rejects guests before either profile mutation', async () => {
    const id = new Types.ObjectId().toHexString();
    for (const request of [
      t.http().post('/api/hotels').send(profile),
      t.http().patch(`/api/hotels/${id}`).send({ name: 'Denied' }),
    ]) {
      const response = await request.expect(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        code: ErrorCode.NotAuthenticated,
      });
    }
    expect(await hotels.countDocuments()).toBe(0);
  });

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'rejects hotel creation by %s with 403',
    async (role) => {
      const user = await loginAs(t.connection, role);
      const response = await t
        .http()
        .post('/api/hotels')
        .set('Cookie', user.cookie)
        .send(profile)
        .expect(403);
      expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
      expect(await hotels.countDocuments()).toBe(0);
    },
  );

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.ADMIN])(
    'rejects hotel editing by %s with 403',
    async (role) => {
      const created = await service.create(profile);
      const user = await loginAs(t.connection, role);
      const response = await t
        .http()
        .patch(`/api/hotels/${created.id}`)
        .set('Cookie', user.cookie)
        .send({ name: 'Denied' })
        .expect(403);
      expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
      expect(await service.getHotel(created.id)).toEqual(created);
    },
  );

  it('returns the same 404 for another hotel and a missing assigned hotel without changing either profile', async () => {
    const created = await service.create(profile);
    const assigned = await service.create({
      ...profile,
      name: 'Assigned Hotel',
    });
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: assigned.id,
    });
    const other = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', moderator.cookie)
      .send({ name: 'Denied' })
      .expect(404);
    const missingId = new Types.ObjectId().toHexString();
    const missingModerator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: missingId,
    });
    const missing = await t
      .http()
      .patch(`/api/hotels/${missingId}`)
      .set('Cookie', missingModerator.cookie)
      .send({ name: 'Missing' })
      .expect(404);
    for (const response of [other, missing]) {
      expect(response.body.code).toBe(ErrorCode.NotFound);
    }
    expect(other.body.message).toBe(missing.body.message);
    expect(await service.getHotel(created.id)).toEqual(created);
    expect(await service.getHotel(assigned.id)).toEqual(assigned);
  });

  it('rejects invalid input and unknown cities through the production validation pipeline', async () => {
    const admin = await loginAs(t.connection, Role.ADMIN);
    for (const input of [
      { ...profile, name: ' ' },
      { ...profile, cityId: 'missing' },
    ]) {
      const response = await t
        .http()
        .post('/api/hotels')
        .set('Cookie', admin.cookie)
        .send(input)
        .expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        code: ErrorCode.ValidationFailed,
        details: expect.arrayContaining([
          expect.objectContaining({
            field: input.name === ' ' ? 'name' : 'cityId',
          }),
        ]),
      });
    }
    expect(await hotels.countDocuments()).toBe(0);
    const created = await service.create(profile);
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    for (const input of [
      { amenities: null },
      { cityId: 'missing', name: 'Must not persist' },
    ]) {
      const response = await t
        .http()
        .patch(`/api/hotels/${created.id}`)
        .set('Cookie', moderator.cookie)
        .send(input)
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    }
    const invalidId = await t
      .http()
      .patch('/api/hotels/not-an-id')
      .set('Cookie', moderator.cookie)
      .send({ name: 'Denied' })
      .expect(400);
    expect(invalidId.body.code).toBe(ErrorCode.ValidationFailed);
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('rejects attempts to supply moderator identity or protected hotel fields', async () => {
    const created = await service.create(profile);
    const admin = await loginAs(t.connection, Role.ADMIN);
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    for (const protectedInput of [
      { providerId: created.id },
      { moderatorHotelId: created.id },
      { countryCode: 'US' },
      { isActive: false },
      { photos: [] },
      { ratingSummary: { average: 5, count: 1 } },
      { checkInTime: '01:00' },
      { cancellationPolicy: { tiers: [] } },
    ]) {
      const createdResponse = await t
        .http()
        .post('/api/hotels')
        .set('Cookie', admin.cookie)
        .send({ ...profile, ...protectedInput })
        .expect(400);
      const updatedResponse = await t
        .http()
        .patch(`/api/hotels/${created.id}`)
        .set('Cookie', moderator.cookie)
        .send(protectedInput)
        .expect(400);
      for (const response of [createdResponse, updatedResponse]) {
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
    }
    expect(await hotels.countDocuments()).toBe(1);
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('enforces session expiry and the first-login password change before editing', async () => {
    const created = await service.create(profile);
    const expired = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
      sessionExpired: true,
    });
    const temporaryPassword = await loginAs(
      t.connection,
      Role.HOTEL_MODERATOR,
      { providerId: created.id, mustChangePassword: true },
    );
    const expiredResponse = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', expired.cookie)
      .send({ name: 'Denied' })
      .expect(401);
    expect(expiredResponse.body.code).toBe(ErrorCode.SessionExpired);
    const gatedResponse = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', temporaryPassword.cookie)
      .send({ name: 'Denied' })
      .expect(403);
    expect(gatedResponse.body.code).toBe(ErrorCode.PasswordChangeRequired);
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('documents the protected profile endpoints, inputs, responses, and errors in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder()
        .setTitle('Travel Platform API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );
    const create = document.paths['/api/hotels']?.post;
    const update = document.paths['/api/hotels/{id}']?.patch;
    for (const operation of [create, update]) {
      expect(operation?.security).toEqual([{ cookie: [] }]);
      expect(operation?.summary).toContain('HTL-01');
      expect(operation?.responses['400']).toBeDefined();
      expect(operation?.responses['401']).toBeDefined();
      expect(operation?.responses['403']).toBeDefined();
    }
    expect(create?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateHotelDto' },
        },
      },
    });
    expect(create?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/HotelProfileResponseDto' },
        },
      },
    });
    expect(update?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateHotelDto' },
        },
      },
    });
    expect(update?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/HotelProfileResponseDto' },
        },
      },
    });
    expect(update?.responses['404']).toBeDefined();
    expect(document.paths['/api/hotels/{id}']?.get).toBeUndefined();
  });
});
