import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Role } from '../accounts/auth/auth.types.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { MAX_IMAGE_BYTES } from '../storage/image-rules.js';
import { StorageService } from '../storage/storage.service.js';
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
  const storage = new FakeStorageService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService())
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    service = t.moduleRef.get(HotelsService);
    hotels = t.moduleRef.get<Model<Hotel>>(getModelToken(Hotel.name));
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCollections(t.connection);
    await Promise.all(storage.keys().map((key) => storage.delete(key)));
  });
  afterAll(() => t.close(), HOOK_TIMEOUT);

  describe('hotel policy endpoint (HTL-09, HTL-10)', () => {
    const policies = {
      checkInTime: '15:30',
      checkOutTime: '11:00',
      cancellationPolicy: {
        tiers: [
          { daysBefore: 7, refundPercent: 100 },
          { daysBefore: 2, refundPercent: 50 },
          { daysBefore: 0, refundPercent: 0 },
        ],
      },
    };

    it('lets the assigned moderator replace policies and clear all cancellation tiers', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      const { id, ...fields } = created;
      const path = `/api/hotels/${id}/policies`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await t
          .http()
          .put(path)
          .set('Cookie', moderator.cookie)
          .send(policies)
          .expect(200);
        expect(response.body).toEqual({ _id: id, ...fields, ...policies });
      }
      expect(await service.getHotel(id)).toEqual({ ...created, ...policies });
      const cleared = {
        ...policies,
        checkInTime: '23:59',
        checkOutTime: '00:00',
        cancellationPolicy: { tiers: [] },
      };
      const response = await t
        .http()
        .put(path)
        .set('Cookie', moderator.cookie)
        .send(cleared)
        .expect(200);
      expect(response.body).toEqual({ _id: id, ...fields, ...cleared });
      expect(await service.getHotel(id)).toEqual({ ...created, ...cleared });
    });

    it('requires authentication and the hotel-moderator role without changing policies', async () => {
      const created = await service.create(profile);
      const path = `/api/hotels/${created.id}/policies`;
      const guest = await t.http().put(path).send(policies).expect(401);
      expect(guest.body.code).toBe(ErrorCode.NotAuthenticated);
      for (const role of [Role.ADMIN, Role.USER, Role.AIRLINE_MODERATOR]) {
        const account = await loginAs(t.connection, role);
        const response = await t
          .http()
          .put(path)
          .set('Cookie', account.cookie)
          .send(policies)
          .expect(403);
        expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
      }
      expect(await service.getHotel(created.id)).toEqual(created);
    });

    it('returns the same 404 for another hotel and a missing assigned hotel', async () => {
      const created = await service.create(profile);
      const assigned = await service.create({
        ...profile,
        name: 'Other Hotel',
      });
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: assigned.id,
      });
      const other = await t
        .http()
        .put(`/api/hotels/${created.id}/policies`)
        .set('Cookie', moderator.cookie)
        .send(policies)
        .expect(404);
      const missingId = new Types.ObjectId().toHexString();
      const missingModerator = await loginAs(
        t.connection,
        Role.HOTEL_MODERATOR,
        { providerId: missingId },
      );
      const missing = await t
        .http()
        .put(`/api/hotels/${missingId}/policies`)
        .set('Cookie', missingModerator.cookie)
        .send(policies)
        .expect(404);
      expect(other.body.code).toBe(ErrorCode.NotFound);
      expect(missing.body.code).toBe(ErrorCode.NotFound);
      expect(other.body.message).toBe(missing.body.message);
      expect(await service.getHotel(created.id)).toEqual(created);
      expect(await service.getHotel(assigned.id)).toEqual(assigned);
    });

    it('rejects invalid and incomplete policies with field errors and no partial writes', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      for (const input of [
        { ...policies, checkInTime: '24:00' },
        { ...policies, checkOutTime: '12:60' },
        { checkInTime: policies.checkInTime },
        {
          ...policies,
          cancellationPolicy: {
            tiers: [
              { daysBefore: 7, refundPercent: 100 },
              { daysBefore: 7, refundPercent: 50 },
            ],
          },
        },
        {
          ...policies,
          cancellationPolicy: {
            tiers: [{ daysBefore: 1.5, refundPercent: 101 }],
          },
        },
        { ...policies, providerId: created.id },
        {
          ...policies,
          cancellationPolicy: { tiers: [], isActive: false },
        },
      ]) {
        const response = await t
          .http()
          .put(`/api/hotels/${created.id}/policies`)
          .set('Cookie', moderator.cookie)
          .send(input)
          .expect(400);
        expect(response.body).toMatchObject({
          code: ErrorCode.ValidationFailed,
          details: expect.arrayContaining([
            expect.objectContaining({ field: expect.any(String) }),
          ]),
        });
        expect(await service.getHotel(created.id)).toEqual(created);
      }
      const malformed = await t
        .http()
        .put('/api/hotels/invalid/policies')
        .set('Cookie', moderator.cookie)
        .send(policies)
        .expect(400);
      expect(malformed.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('hotel photo endpoints', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    it('uploads JPG and PNG images with computed URLs and deletes a selected photo', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      for (const [filename, contentType] of [
        ['hotel.jpg', 'image/jpeg'],
        ['hotel.png', 'image/png'],
      ]) {
        const response = await t
          .http()
          .post(`/api/hotels/${created.id}/photos`)
          .set('Cookie', moderator.cookie)
          .attach('file', bytes, { filename, contentType })
          .expect(201);
        for (const photo of response.body.photos) {
          expect(photo).toEqual({
            _id: expect.any(String),
            key: expect.any(String),
            url: `/uploads/${photo.key}`,
          });
          expect(storage.has(photo.key)).toBe(true);
        }
      }
      const photos = (await service.getHotel(created.id))!.photos;
      expect(photos).toHaveLength(2);
      const response = await t
        .http()
        .delete(`/api/hotels/${created.id}/photos/${photos[0]!.id}`)
        .set('Cookie', moderator.cookie)
        .expect(204);
      expect(response.text).toBe('');
      expect(storage.has(photos[0]!.key)).toBe(false);
      expect((await service.getHotel(created.id))!.photos).toEqual([photos[1]]);
    });

    it('accepts an image of exactly 5 MB', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      const image = Buffer.alloc(MAX_IMAGE_BYTES);
      bytes.copy(image);
      await t
        .http()
        .post(`/api/hotels/${created.id}/photos`)
        .set('Cookie', moderator.cookie)
        .attach('file', image, {
          filename: 'boundary.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
      expect(storage.bytesOf(storage.keys()[0]!)?.length).toBe(MAX_IMAGE_BYTES);
    });

    it('rejects missing, empty, unsupported and oversized files without saving them', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      const path = `/api/hotels/${created.id}/photos`;
      const missing = await t
        .http()
        .post(path)
        .set('Cookie', moderator.cookie)
        .expect(400);
      expect(missing.body.code).toBe(ErrorCode.ValidationFailed);
      for (const [buffer, filename, contentType] of [
        [Buffer.alloc(0), 'empty.jpg', 'image/jpeg'],
        [bytes, 'document.pdf', 'application/pdf'],
      ] as const) {
        const response = await t
          .http()
          .post(path)
          .set('Cookie', moderator.cookie)
          .attach('file', buffer, { filename, contentType })
          .expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
      const oversized = await t
        .http()
        .post(path)
        .set('Cookie', moderator.cookie)
        .attach('file', Buffer.alloc(MAX_IMAGE_BYTES + 1), {
          filename: 'large.jpg',
          contentType: 'image/jpeg',
        })
        .expect(413);
      expect(oversized.body.code).toBe(ErrorCode.RequestFailed);
      const multiple = await t
        .http()
        .post(path)
        .set('Cookie', moderator.cookie)
        .attach('file', bytes, 'one.jpg')
        .attach('file', bytes, 'two.jpg')
        .expect(400);
      expect(multiple.body.code).toBe(ErrorCode.ValidationFailed);
      expect(storage.keys()).toEqual([]);
      expect((await service.getHotel(created.id))!.photos).toEqual([]);
    });

    it('rejects the sixth photo and retains exactly the five attached files', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      for (let i = 0; i < 5; i++) {
        await t
          .http()
          .post(`/api/hotels/${created.id}/photos`)
          .set('Cookie', moderator.cookie)
          .attach('file', bytes, 'hotel.jpg')
          .expect(201);
      }
      const response = await t
        .http()
        .post(`/api/hotels/${created.id}/photos`)
        .set('Cookie', moderator.cookie)
        .attach('file', bytes, 'extra.jpg')
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.LimitExceeded);
      expect((await service.getHotel(created.id))!.photos).toHaveLength(5);
      expect(storage.keys()).toHaveLength(5);
    });

    it('requires authentication and the hotel-moderator role for both operations', async () => {
      const created = await service.create(profile);
      const path = `/api/hotels/${created.id}/photos`;
      const photoId = new Types.ObjectId().toHexString();
      const guestUpload = await t.http().post(path).expect(401);
      const guestDelete = await t
        .http()
        .delete(`${path}/${photoId}`)
        .expect(401);
      for (const response of [guestUpload, guestDelete])
        expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
      for (const role of [Role.ADMIN, Role.USER, Role.AIRLINE_MODERATOR]) {
        const user = await loginAs(t.connection, role);
        const upload = await t
          .http()
          .post(path)
          .set('Cookie', user.cookie)
          .expect(403);
        const remove = await t
          .http()
          .delete(`${path}/${photoId}`)
          .set('Cookie', user.cookie)
          .expect(403);
        for (const response of [upload, remove])
          expect(response.body.code).toBe(ErrorCode.ForbiddenRole);
      }
      expect(storage.keys()).toEqual([]);
    });

    it('does not expose or mutate another moderator hotel, even with a spoofed body assignment', async () => {
      const created = await service.create(profile);
      const photo = (
        await service.addPhoto(
          created.id,
          {
            buffer: bytes,
            originalname: 'hotel.jpg',
            mimetype: 'image/jpeg',
            size: bytes.length,
          },
          created.id,
        )
      ).photos[0]!;
      const other = await loginAs(t.connection, Role.HOTEL_MODERATOR);
      const upload = await t
        .http()
        .post(`/api/hotels/${created.id}/photos`)
        .set('Cookie', other.cookie)
        .field('providerId', created.id)
        .attach('file', bytes, 'denied.jpg')
        .expect(404);
      const remove = await t
        .http()
        .delete(`/api/hotels/${created.id}/photos/${photo.id}`)
        .set('Cookie', other.cookie)
        .expect(404);
      expect(upload.body.code).toBe(ErrorCode.NotFound);
      expect(remove.body.code).toBe(ErrorCode.NotFound);
      expect((await service.getHotel(created.id))!.photos).toEqual([photo]);
      expect(storage.keys()).toEqual([photo.key]);
    });

    it('rejects missing photos and malformed IDs without deleting a file', async () => {
      const created = await service.create(profile);
      const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        providerId: created.id,
      });
      const missing = await t
        .http()
        .delete(
          `/api/hotels/${created.id}/photos/${new Types.ObjectId().toHexString()}`,
        )
        .set('Cookie', moderator.cookie)
        .expect(404);
      expect(missing.body.code).toBe(ErrorCode.NotFound);
      const malformedPhoto = await t
        .http()
        .delete(`/api/hotels/${created.id}/photos/invalid`)
        .set('Cookie', moderator.cookie)
        .expect(400);
      const malformedHotel = await t
        .http()
        .post('/api/hotels/invalid/photos')
        .set('Cookie', moderator.cookie)
        .attach('file', bytes, 'hotel.jpg')
        .expect(400);
      for (const response of [malformedPhoto, malformedHotel])
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      expect(storage.keys()).toEqual([]);
    });
  });

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
      _id: expect.stringMatching(/^[0-9a-f]{24}$/),
      countryCode: 'EG',
      photos: [],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationPolicy: { tiers: [] },
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    });
    const { _id, ...fields } = response.body;
    expect(await service.getHotel(_id)).toEqual({ id: _id, ...fields });
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
    const { id, ...fields } = created;
    expect(response.body).toEqual({
      ...fields,
      _id: id,
      name: 'Dubai View',
      cityId: 'dubai',
      countryCode: 'AE',
    });
    expect(await service.getHotel(created.id)).toEqual({
      ...created,
      name: 'Dubai View',
      cityId: 'dubai',
      countryCode: 'AE',
    });
  });

  it('allows the assigned moderator to edit a deactivated hotel without reactivating it', async () => {
    const created = await service.create(profile);
    await service.setActive(created.id, false);
    const moderator = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
      providerId: created.id,
    });
    const response = await t
      .http()
      .patch(`/api/hotels/${created.id}`)
      .set('Cookie', moderator.cookie)
      .send({ name: 'Edited while hidden' })
      .expect(200);
    expect(response.body).toMatchObject({
      _id: created.id,
      name: 'Edited while hidden',
      isActive: false,
    });
    expect(await service.getHotel(created.id)).toEqual({
      ...created,
      name: 'Edited while hidden',
      isActive: false,
    });
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
        _id: photoId.toHexString(),
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
    const upload = document.paths['/api/hotels/{id}/photos']?.post;
    const remove = document.paths['/api/hotels/{id}/photos/{photoId}']?.delete;
    for (const operation of [create, update, upload, remove]) {
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
    expect(upload?.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: {
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary' } },
          },
        },
      },
    });
    expect(upload?.responses['201']).toBeDefined();
    expect(upload?.responses['400']).toBeDefined();
    expect(upload?.responses['409']).toBeUndefined();
    expect(remove?.responses['204']).toBeDefined();
    expect(remove?.responses['404']).toBeDefined();
    const policies = document.paths['/api/hotels/{id}/policies']?.put;
    expect(policies?.security).toEqual([{ cookie: [] }]);
    expect(policies?.summary).toContain('HTL-09');
    expect(policies?.summary).toContain('HTL-10');
    expect(policies?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateHotelPoliciesDto' },
        },
      },
    });
    expect(policies?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/HotelProfileResponseDto' },
        },
      },
    });
    for (const status of ['400', '401', '403', '404']) {
      expect(policies?.responses[status]).toBeDefined();
    }
    expect(document.components?.schemas?.UpdateHotelPoliciesDto).toMatchObject({
      required: ['checkInTime', 'checkOutTime', 'cancellationPolicy'],
    });
    expect(document.paths['/api/hotels/{id}']?.get).toBeUndefined();
  });
});
