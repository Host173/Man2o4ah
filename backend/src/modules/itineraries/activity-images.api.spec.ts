import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { loginAs, type LoggedInUser } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { MAX_IMAGE_BYTES } from '../storage/image-rules.js';
import { StorageService } from '../storage/storage.service.js';
import { ItinerariesModule } from './itineraries.module.js';
import { Itinerary } from './schemas/itinerary.schema.js';

const sampleBytes = Buffer.from('fake-jpeg-bytes');

describe('ITN-12 activity image HTTP API (limits and contracts)', () => {
  let testApp: TestApp;
  let model: Model<Itinerary>;
  const storage = new FakeStorageService();

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [ItinerariesModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService())
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    model = testApp.moduleRef.get<Model<Itinerary>>(
      getModelToken(Itinerary.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(testApp.connection);
    for (const key of storage.keys()) await storage.delete(key);
  });

  afterAll(async () => {
    await testApp.close();
  }, HOOK_TIMEOUT);

  async function seedActivity(user: LoggedInUser): Promise<string> {
    const created = await testApp
      .http()
      .post('/api/itineraries')
      .set('Cookie', user.cookie)
      .send({ title: 'Cairo', countryCodes: ['EG'], startDate: '2027-04-01' });
    const itineraryId = created.body._id as string;
    await testApp
      .http()
      .post(`/api/itineraries/${itineraryId}/days`)
      .set('Cookie', user.cookie)
      .send({ cityId: 'cairo' });
    const dayId = new Types.ObjectId();
    const activityId = new Types.ObjectId();
    await model.updateOne(
      { _id: new Types.ObjectId(itineraryId) },
      {
        $set: {
          days: [
            {
              _id: dayId,
              cityId: 'cairo',
              activities: [{ _id: activityId, name: 'Pyramids', images: [] }],
              budgetEntries: [],
            },
          ],
          dayCount: 1,
          cityIds: ['cairo'],
        },
      },
    );
    return activityId.toHexString();
  }

  function attach(activityId: string, cookie: string, fileName = 'tour.jpg') {
    return testApp
      .http()
      .post(`/api/activities/${activityId}/images`)
      .set('Cookie', cookie)
      .attach('file', sampleBytes, {
        filename: fileName,
        contentType: fileName.endsWith('.png') ? 'image/png' : 'image/jpeg',
      });
  }

  it('registers both image routes in Swagger with ITN-12 summaries and auth', () => {
    const document = SwaggerModule.createDocument(
      testApp.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );
    const add = document.paths['/api/activities/{id}/images'];
    const remove = document.paths['/api/activities/{id}/images/{imageId}'];
    expect(add?.post).toBeDefined();
    expect(remove?.delete).toBeDefined();
    expect(add?.post?.summary).toContain('ITN-12');
    expect(remove?.delete?.summary).toContain('ITN-12');
    expect(add?.post?.security).toBeDefined();
    expect(remove?.delete?.security).toBeDefined();
    expect(document.components?.schemas?.ItineraryDayResponseDto).toBeDefined();
  });

  it('rejects both routes without a session (401 NOT_AUTHENTICATED)', async () => {
    const id = new Types.ObjectId().toHexString();
    const responses = await Promise.all([
      testApp.http().post(`/api/activities/${id}/images`),
      testApp.http().delete(`/api/activities/${id}/images/${id}`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
    }
  });

  it('attaches a JPG and a PNG, computing no stored url', async () => {
    const user = await loginAs(testApp.connection, UserRole.USER);
    const activityId = await seedActivity(user);

    const jpg = await attach(activityId, user.cookie, 'one.jpg');
    expect(jpg.status).toBe(201);
    expect(jpg.body.activities[0].images).toHaveLength(1);
    expect(jpg.body.activities[0].images[0]).toEqual({
      _id: expect.stringMatching(/^[0-9a-f]{24}$/),
      key: expect.stringMatching(/^[0-9a-f]{24}\.jpg$/),
    });

    const png = await attach(activityId, user.cookie, 'two.png');
    expect(png.status).toBe(201);
    expect(png.body.activities[0].images[1].key).toMatch(/^[0-9a-f]{24}\.png$/);

    const stored = await model
      .findOne({ 'days.activities._id': new Types.ObjectId(activityId) })
      .lean()
      .exec();
    expect(stored?.days[0].activities[0].images).toHaveLength(2);
    expect('url' in (stored?.days[0].activities[0].images[0] ?? {})).toBe(
      false,
    );
  });

  it('accepts exactly 5 images but rejects the 6th with LIMIT_EXCEEDED', async () => {
    const user = await loginAs(testApp.connection, UserRole.USER);
    const activityId = await seedActivity(user);
    for (let i = 0; i < 5; i++) {
      const response = await attach(activityId, user.cookie, `${i}.jpg`);
      expect(response.status).toBe(201);
      expect(response.body.activities[0].images).toHaveLength(i + 1);
    }
    const keysBefore = [...storage.keys()];

    const sixth = await attach(activityId, user.cookie, 'six.jpg');
    expect(sixth.status).toBe(400);
    expect(sixth.body.code).toBe(ErrorCode.LimitExceeded);
    expect(storage.keys()).toEqual(keysBefore);
  });

  it('rejects wrong types, empty files, oversized files and a missing file', async () => {
    const user = await loginAs(testApp.connection, UserRole.USER);
    const activityId = await seedActivity(user);

    const wrongType = await testApp
      .http()
      .post(`/api/activities/${activityId}/images`)
      .set('Cookie', user.cookie)
      .attach('file', sampleBytes, {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.code).toBe(ErrorCode.ValidationFailed);

    const empty = await testApp
      .http()
      .post(`/api/activities/${activityId}/images`)
      .set('Cookie', user.cookie)
      .attach('file', Buffer.alloc(0), {
        filename: 'empty.jpg',
        contentType: 'image/jpeg',
      });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe(ErrorCode.ValidationFailed);

    const oversized = await testApp
      .http()
      .post(`/api/activities/${activityId}/images`)
      .set('Cookie', user.cookie)
      .attach('file', Buffer.alloc(MAX_IMAGE_BYTES + 1), {
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
      });
    expect(oversized.status).toBe(413);
    expect(oversized.body.code).toBe(ErrorCode.RequestFailed);

    const missing = await testApp
      .http()
      .post(`/api/activities/${activityId}/images`)
      .set('Cookie', user.cookie);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe(ErrorCode.ValidationFailed);

    expect(storage.keys()).toEqual([]);
  });

  it('returns 400 for malformed IDs and 404 for another user’s activity', async () => {
    const user = await loginAs(testApp.connection, UserRole.USER);
    const other = await loginAs(testApp.connection, UserRole.USER);
    const activityId = await seedActivity(user);

    const badId = await testApp
      .http()
      .post('/api/activities/not-an-objectid/images')
      .set('Cookie', user.cookie)
      .attach('file', sampleBytes, {
        filename: 'ok.jpg',
        contentType: 'image/jpeg',
      });
    expect(badId.status).toBe(400);
    expect(badId.body.code).toBe(ErrorCode.ValidationFailed);

    const foreign = await attach(activityId, other.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe(ErrorCode.NotFound);
  });

  it('removes an image (204) and 404s on a repeat or a foreign activity', async () => {
    const user = await loginAs(testApp.connection, UserRole.USER);
    const other = await loginAs(testApp.connection, UserRole.USER);
    const activityId = await seedActivity(user);
    const added = await attach(activityId, user.cookie);
    const imageId = added.body.activities[0].images[0]._id as string;
    const key = added.body.activities[0].images[0].key as string;

    const foreign = await testApp
      .http()
      .delete(`/api/activities/${activityId}/images/${imageId}`)
      .set('Cookie', other.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe(ErrorCode.NotFound);

    const removed = await testApp
      .http()
      .delete(`/api/activities/${activityId}/images/${imageId}`)
      .set('Cookie', user.cookie);
    expect(removed.status).toBe(204);
    expect(storage.has(key)).toBe(false);

    const repeated = await testApp
      .http()
      .delete(`/api/activities/${activityId}/images/${imageId}`)
      .set('Cookie', user.cookie);
    expect(repeated.status).toBe(404);
    expect(repeated.body.code).toBe(ErrorCode.NotFound);
  });

  it('deletes activity image files when the itinerary is deleted via the API', async () => {
    const user = await loginAs(testApp.connection, UserRole.USER);
    const activityId = await seedActivity(user);
    await attach(activityId, user.cookie);
    expect(storage.keys()).toHaveLength(1);

    const itinerary = await model
      .findOne({ 'days.activities._id': new Types.ObjectId(activityId) })
      .lean()
      .exec();
    const response = await testApp
      .http()
      .delete(`/api/itineraries/${itinerary!._id.toString()}`)
      .set('Cookie', user.cookie);
    expect(response.status).toBe(204);
    expect(storage.keys()).toEqual([]);
  });
});
