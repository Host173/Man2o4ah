import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ItinerariesModule } from './itineraries.module.js';
import { Itinerary, ItineraryVisibility } from './schemas/itinerary.schema.js';

const validBody = {
  title: '  Egypt in a week  ',
  countryCodes: ['EG'],
  startDate: '2027-04-01',
};

function errorDetails(body: { details?: { field: string }[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field);
}

/** A validation error on `dayIds`, whether the item is reported as `dayIds` or `dayIds.0`. */
function mentionsDayIds(body: { details?: { field: string }[] }): boolean {
  return errorDetails(body).some(
    (field) => field === 'dayIds' || field.startsWith('dayIds.'),
  );
}

describe('ItinerariesController HTTP API (ITN-01, ITN-03)', () => {
  let testApp: TestApp;
  let itineraryModel: Model<Itinerary>;
  const referenceData = new FakeReferenceDataService();
  const storage = new FakeStorageService();

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [ItinerariesModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(referenceData)
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    itineraryModel = testApp.moduleRef.get<Model<Itinerary>>(
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

  /** Creates an itinerary through the API and returns its ID. */
  async function createOwnedItinerary(cookie: string): Promise<string> {
    const response = await testApp
      .http()
      .post('/api/itineraries')
      .set('Cookie', cookie)
      .send(validBody);
    return response.body._id as string;
  }

  /** Inserts `count` days straight into the model, to reach the 60-day limit quickly. */
  async function seedDays(itineraryId: string, count: number): Promise<void> {
    await itineraryModel.updateOne(
      { _id: new Types.ObjectId(itineraryId) },
      {
        $set: {
          days: Array.from({ length: count }, () => ({
            _id: new Types.ObjectId(),
            cityId: 'cairo',
            activities: [],
            budgetEntries: [],
          })),
          dayCount: count,
          cityIds: ['cairo'],
        },
      },
    );
  }

  /**
   * Seeds a trip with one activity (with an image), one budget entry and one
   * transport cost per day, straight into the model. Returns the stored IDs so
   * a test can check the cascade and the order.
   */
  async function seedTrip(
    itineraryId: string,
    cityIds = ['cairo', 'dubai', 'cairo'],
  ): Promise<{ dayIds: string[]; costIds: string[] }> {
    const days = cityIds.map((cityId, index) => ({
      _id: new Types.ObjectId(),
      cityId,
      activities: [
        {
          _id: new Types.ObjectId(),
          name: `${cityId} ${index + 1}`,
          description: 'Visit',
          images: [
            { _id: new Types.ObjectId(), key: `${cityId}-${index + 1}.jpg` },
          ],
        },
      ],
      budgetEntries: [
        {
          _id: new Types.ObjectId(),
          category: 'food',
          amountMinor: 1000,
          currency: 'EGP',
          note: 'Lunch',
        },
      ],
    }));
    const transportCosts = days.map((day, index) => ({
      _id: new Types.ObjectId(),
      dayId: day._id,
      mode: 'train',
      fromCityId: cityIds[index],
      toCityId: cityIds[(index + 1) % cityIds.length],
      amountMinor: 1000 * (index + 1),
      currency: 'EGP',
    }));

    await itineraryModel.collection.updateOne(
      { _id: new Types.ObjectId(itineraryId) },
      {
        $set: {
          days,
          dayCount: days.length,
          cityIds: [...new Set(cityIds)].sort(),
          transportCosts,
        },
      },
    );

    return {
      dayIds: days.map((day) => day._id.toHexString()),
      costIds: transportCosts.map((cost) => cost._id.toHexString()),
    };
  }

  it('registers the itinerary endpoints in Swagger as authenticated routes', () => {
    const document = SwaggerModule.createDocument(
      testApp.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );

    expect(document.paths['/api/itineraries']?.post).toBeDefined();
    expect(document.paths['/api/itineraries']?.get).toBeDefined();
    expect(document.paths['/api/itineraries/{id}']?.get).toBeDefined();
    expect(document.paths['/api/itineraries/{id}']?.patch).toBeDefined();
    expect(document.paths['/api/itineraries/{id}/hotels']?.get).toBeDefined();
    expect(document.paths['/api/itineraries/{id}']?.delete).toBeDefined();
    expect(document.paths['/api/itineraries/{id}/days']?.post).toBeDefined();
    expect(
      document.paths['/api/itineraries/{id}/days/{dayId}']?.patch,
    ).toBeDefined();
    expect(
      document.paths['/api/itineraries/{id}/days/{dayId}']?.delete,
    ).toBeDefined();
    expect(
      document.paths['/api/itineraries/{id}/days/reorder']?.patch,
    ).toBeDefined();
    expect(document.components?.schemas?.CityGroupResponseDto).toBeDefined();
    for (const method of ['post', 'get'] as const) {
      expect(
        document.paths['/api/itineraries']?.[method]?.security,
      ).toBeDefined();
    }
    for (const method of ['get', 'patch', 'delete'] as const) {
      expect(
        document.paths['/api/itineraries/{id}']?.[method]?.security,
      ).toBeDefined();
    }
    for (const [path, method] of [
      ['/api/itineraries/{id}/days', 'post'],
      ['/api/itineraries/{id}/days/{dayId}', 'patch'],
      ['/api/itineraries/{id}/days/{dayId}', 'delete'],
      ['/api/itineraries/{id}/days/reorder', 'patch'],
    ] as const) {
      expect(document.paths[path]?.[method]?.security).toBeDefined();
    }
  });

  describe('authentication', () => {
    it('rejects every itinerary endpoint without a session (401 NOT_AUTHENTICATED)', async () => {
      const id = new Types.ObjectId().toHexString();

      const responses = await Promise.all([
        testApp.http().get('/api/itineraries'),
        testApp.http().post('/api/itineraries').send(validBody),
        testApp.http().get(`/api/itineraries/${id}`),
        testApp.http().patch(`/api/itineraries/${id}`).send({ title: 'New' }),
        testApp.http().delete(`/api/itineraries/${id}`),
        testApp
          .http()
          .post(`/api/itineraries/${id}/days`)
          .send({ cityId: 'cairo' }),
        testApp
          .http()
          .patch(`/api/itineraries/${id}/days/${id}`)
          .send({ cityId: 'dubai' }),
        testApp.http().delete(`/api/itineraries/${id}/days/${id}`),
        testApp
          .http()
          .patch(`/api/itineraries/${id}/days/reorder`)
          .send({ dayIds: [] }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
      }
    });

    it('rejects expired sessions with 401 SESSION_EXPIRED', async () => {
      const expired = await loginAs(testApp.connection, UserRole.USER, {
        sessionExpired: true,
      });

      const response = await testApp
        .http()
        .get('/api/itineraries')
        .set('Cookie', expired.cookie);

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.SessionExpired);
    });
  });

  describe('POST /api/itineraries (ITN-01)', () => {
    it('creates a private itinerary for the authenticated user', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);

      const response = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        ownerId: owner.id,
        title: 'Egypt in a week',
        countryCodes: ['EG'],
        startDate: '2027-04-01',
        dayCount: 0,
        visibility: ItineraryVisibility.PRIVATE,
        isHidden: false,
        authorDeactivated: false,
        days: [],
        transportCosts: [],
      });
      expect(response.body._id).toMatch(/^[0-9a-f]{24}$/);
      expect(typeof response.body.createdAt).toBe('string');
      expect(typeof response.body.updatedAt).toBe('string');
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('clonedFrom');
    });

    it('accepts the title boundaries of 1 and 100 characters', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);

      // Emoji count as one character each, not two UTF-16 code units.
      for (const title of [
        'x',
        '😀',
        `  ${'x'.repeat(100)}  `,
        `  ${'😀'.repeat(100)}  `,
      ]) {
        const response = await testApp
          .http()
          .post('/api/itineraries')
          .set('Cookie', owner.cookie)
          .send({ ...validBody, title });
        expect(response.status).toBe(201);
        expect(response.body.title).toBe(title.trim());
      }
    });

    it('rejects invalid payloads with 400 VALIDATION_FAILED and field details', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);

      const cases: { body: Record<string, unknown>; field: string }[] = [
        { body: { ...validBody, title: '   ' }, field: 'title' },
        { body: { ...validBody, title: 'x'.repeat(101) }, field: 'title' },
        { body: { ...validBody, title: '😀'.repeat(101) }, field: 'title' },
        { body: { ...validBody, title: undefined }, field: 'title' },
        { body: { ...validBody, countryCodes: [] }, field: 'countryCodes' },
        {
          body: { ...validBody, countryCodes: ['EG', 'EG'] },
          field: 'countryCodes',
        },
        { body: { ...validBody, countryCodes: ['ZZ'] }, field: 'countryCodes' },
        { body: { ...validBody, startDate: '01/04/2027' }, field: 'startDate' },
        { body: { ...validBody, startDate: '2027-02-30' }, field: 'startDate' },
        {
          body: { ...validBody, ownerId: new Types.ObjectId().toHexString() },
          field: 'ownerId',
        },
        { body: { ...validBody, visibility: 'public' }, field: 'visibility' },
        { body: { ...validBody, dayCount: 5 }, field: 'dayCount' },
      ];

      for (const { body, field } of cases) {
        const response = await testApp
          .http()
          .post('/api/itineraries')
          .set('Cookie', owner.cookie)
          .send(body);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
        expect(errorDetails(response.body)).toContain(field);
      }

      expect(await itineraryModel.countDocuments({}).exec()).toBe(0);
    });

    it('accepts several distinct countries from the dataset', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);

      const response = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({ ...validBody, countryCodes: ['EG', 'AE', 'US'] });

      expect(response.status).toBe(201);
      expect(response.body.countryCodes).toEqual(['EG', 'AE', 'US']);
    });
  });

  describe('GET /api/itineraries (ITN-03)', () => {
    it('lists only the current user’s itineraries, most recently updated first', async () => {
      const alice = await loginAs(testApp.connection, UserRole.USER);
      const bob = await loginAs(testApp.connection, UserRole.USER);

      const create = (title: string, cookie: string) =>
        testApp
          .http()
          .post('/api/itineraries')
          .set('Cookie', cookie)
          .send({ ...validBody, title });

      const first = await create('First', alice.cookie);
      const second = await create('Second', alice.cookie);
      await create('Bob’s trip', bob.cookie);

      await itineraryModel.collection.updateOne(
        { _id: new Types.ObjectId(first.body._id as string) },
        { $set: { updatedAt: new Date('2030-01-01T00:00:00.000Z') } },
      );
      await itineraryModel.collection.updateOne(
        { _id: new Types.ObjectId(second.body._id as string) },
        { $set: { updatedAt: new Date('2029-01-01T00:00:00.000Z') } },
      );

      const response = await testApp
        .http()
        .get('/api/itineraries')
        .set('Cookie', alice.cookie);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      expect(
        response.body.items.map(
          (itinerary: { title: string }) => itinerary.title,
        ),
      ).toEqual(['First', 'Second']);
      expect(
        response.body.items.every(
          (itinerary: { ownerId: string }) => itinerary.ownerId === alice.id,
        ),
      ).toBe(true);
      expect(response.body.items[0]).toMatchObject({
        countryCodes: ['EG'],
        startDate: '2027-04-01',
        dayCount: 0,
        visibility: ItineraryVisibility.PRIVATE,
      });
    });

    it('paginates the list and rejects invalid pagination parameters', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      for (const title of ['One', 'Two', 'Three']) {
        await testApp
          .http()
          .post('/api/itineraries')
          .set('Cookie', owner.cookie)
          .send({ ...validBody, title });
      }

      const page2 = await testApp
        .http()
        .get('/api/itineraries?page=2&limit=2')
        .set('Cookie', owner.cookie);
      expect(page2.status).toBe(200);
      expect(page2.body).toMatchObject({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(page2.body.items).toHaveLength(1);

      for (const query of ['page=0', 'limit=51', 'limit=0', 'status=public']) {
        const response = await testApp
          .http()
          .get(`/api/itineraries?${query}`)
          .set('Cookie', owner.cookie);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
    });
  });

  describe('GET /api/itineraries/:id (ITN-03)', () => {
    it('opens the owner’s itinerary with its full details', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const created = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send(validBody);

      const response = await testApp
        .http()
        .get(`/api/itineraries/${created.body._id}`)
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        _id: created.body._id,
        ownerId: owner.id,
        title: 'Egypt in a week',
        countryCodes: ['EG'],
        startDate: '2027-04-01',
        dayCount: 0,
        visibility: ItineraryVisibility.PRIVATE,
        days: [],
        transportCosts: [],
      });
    });

    it('returns 404 for another user’s itinerary (including an admin) and for a missing one', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const otherUser = await loginAs(testApp.connection, UserRole.USER);
      const admin = await loginAs(testApp.connection, UserRole.ADMIN);

      const created = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send(validBody);

      for (const intruder of [otherUser, admin]) {
        const response = await testApp
          .http()
          .get(`/api/itineraries/${created.body._id}`)
          .set('Cookie', intruder.cookie);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe(ErrorCode.NotFound);
      }

      const missing = await testApp
        .http()
        .get(`/api/itineraries/${new Types.ObjectId().toHexString()}`)
        .set('Cookie', owner.cookie);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe(ErrorCode.NotFound);
    });

    it('rejects a malformed ID with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);

      const response = await testApp
        .http()
        .get('/api/itineraries/not-an-id')
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('PATCH /api/itineraries/:id (ITN-01)', () => {
    it('lets the owner edit the title, countries and start date', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const created = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send(validBody);

      const response = await testApp
        .http()
        .patch(`/api/itineraries/${created.body._id}`)
        .set('Cookie', owner.cookie)
        .send({
          title: '  Egypt and the UAE  ',
          countryCodes: ['EG', 'AE'],
          startDate: '2027-05-10',
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        _id: created.body._id,
        ownerId: owner.id,
        title: 'Egypt and the UAE',
        countryCodes: ['EG', 'AE'],
        startDate: '2027-05-10',
        visibility: ItineraryVisibility.PRIVATE,
      });
      expect(response.body.updatedAt >= created.body.updatedAt).toBe(true);
    });

    it('keeps omitted fields and returns the current itinerary for an empty body', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const created = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send(validBody);

      const partial = await testApp
        .http()
        .patch(`/api/itineraries/${created.body._id}`)
        .set('Cookie', owner.cookie)
        .send({ title: 'Renamed' });
      expect(partial.status).toBe(200);
      expect(partial.body).toMatchObject({
        title: 'Renamed',
        countryCodes: ['EG'],
        startDate: '2027-04-01',
      });

      const empty = await testApp
        .http()
        .patch(`/api/itineraries/${created.body._id}`)
        .set('Cookie', owner.cookie)
        .send({});
      expect(empty.status).toBe(200);
      expect(empty.body).toMatchObject({
        title: 'Renamed',
        countryCodes: ['EG'],
        startDate: '2027-04-01',
      });
    });

    it('rejects invalid updates with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const created = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send(validBody);

      const cases: { body: Record<string, unknown>; field: string }[] = [
        { body: { title: null }, field: 'title' },
        { body: { title: '   ' }, field: 'title' },
        { body: { title: 'x'.repeat(101) }, field: 'title' },
        { body: { title: '😀'.repeat(101) }, field: 'title' },
        { body: { countryCodes: [] }, field: 'countryCodes' },
        { body: { countryCodes: ['ZZ'] }, field: 'countryCodes' },
        { body: { startDate: '2027-02-30' }, field: 'startDate' },
        {
          body: { ownerId: new Types.ObjectId().toHexString() },
          field: 'ownerId',
        },
      ];

      for (const { body, field } of cases) {
        const response = await testApp
          .http()
          .patch(`/api/itineraries/${created.body._id}`)
          .set('Cookie', owner.cookie)
          .send(body);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
        expect(errorDetails(response.body)).toContain(field);
      }

      const unchanged = await testApp
        .http()
        .get(`/api/itineraries/${created.body._id}`)
        .set('Cookie', owner.cookie);
      expect(unchanged.body).toMatchObject({
        title: 'Egypt in a week',
        countryCodes: ['EG'],
        startDate: '2027-04-01',
      });
    });

    it('returns 404 for another user’s itinerary (including an admin) and leaves it untouched', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const otherUser = await loginAs(testApp.connection, UserRole.USER);
      const admin = await loginAs(testApp.connection, UserRole.ADMIN);
      const created = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send(validBody);

      for (const intruder of [otherUser, admin]) {
        const response = await testApp
          .http()
          .patch(`/api/itineraries/${created.body._id}`)
          .set('Cookie', intruder.cookie)
          .send({ title: 'Hijacked' });
        expect(response.status).toBe(404);
        expect(response.body.code).toBe(ErrorCode.NotFound);
      }

      const stored = await testApp
        .http()
        .get(`/api/itineraries/${created.body._id}`)
        .set('Cookie', owner.cookie);
      expect(stored.body.title).toBe('Egypt in a week');
    });

    it('rejects a malformed ID with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);

      const response = await testApp
        .http()
        .patch('/api/itineraries/not-an-id')
        .set('Cookie', owner.cookie)
        .send({ title: 'New' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('DELETE /api/itineraries/:id (ITN-01)', () => {
    it('deletes the owner’s itinerary and removes it from the list', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const created = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send(validBody);

      const response = await testApp
        .http()
        .delete(`/api/itineraries/${created.body._id}`)
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(204);
      expect(response.text).toBe('');

      const afterDelete = await testApp
        .http()
        .get(`/api/itineraries/${created.body._id}`)
        .set('Cookie', owner.cookie);
      expect(afterDelete.status).toBe(404);

      const list = await testApp
        .http()
        .get('/api/itineraries')
        .set('Cookie', owner.cookie);
      expect(list.body.total).toBe(0);

      const repeated = await testApp
        .http()
        .delete(`/api/itineraries/${created.body._id}`)
        .set('Cookie', owner.cookie);
      expect(repeated.status).toBe(404);
      expect(repeated.body.code).toBe(ErrorCode.NotFound);
    });

    it('returns 404 for another user’s itinerary (including an admin) and leaves it in place', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const otherUser = await loginAs(testApp.connection, UserRole.USER);
      const admin = await loginAs(testApp.connection, UserRole.ADMIN);
      const created = await testApp
        .http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send(validBody);

      for (const intruder of [otherUser, admin]) {
        const response = await testApp
          .http()
          .delete(`/api/itineraries/${created.body._id}`)
          .set('Cookie', intruder.cookie);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe(ErrorCode.NotFound);
      }

      expect(await itineraryModel.countDocuments({}).exec()).toBe(1);
    });

    it('rejects a malformed ID with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);

      const response = await testApp
        .http()
        .delete('/api/itineraries/not-an-id')
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('POST /api/itineraries/:id/days (ITN-05)', () => {
    it('adds days numbered and dated from the start date and returns the city groups', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);

      const first = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo', notes: 'Arrival day' });

      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        dayNumber: 1,
        date: '2027-04-01',
        cityId: 'cairo',
        notes: 'Arrival day',
        activities: [],
        budgetEntries: [],
      });
      expect(first.body._id).toMatch(/^[0-9a-f]{24}$/);

      const second = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo' });

      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ dayNumber: 2, date: '2027-04-02' });

      const detail = await testApp
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie);

      expect(detail.status).toBe(200);
      expect(detail.body.dayCount).toBe(2);
      expect(detail.body.days).toHaveLength(2);
      expect(detail.body.cityGroups).toEqual([
        {
          cityId: 'cairo',
          fromDay: 1,
          toDay: 2,
          dayCount: 2,
          checkIn: '2027-04-01',
          checkOut: '2027-04-03',
        },
      ]);
    });

    it('rejects a missing, blank or unknown city with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);

      for (const body of [
        {},
        { cityId: '   ' },
        { cityId: 'nowhere' },
        { cityId: 42 },
      ]) {
        const response = await testApp
          .http()
          .post(`/api/itineraries/${itineraryId}/days`)
          .set('Cookie', owner.cookie)
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
        expect(errorDetails(response.body)).toContain('cityId');
      }
    });

    it('rejects the 61st day and leaves the itinerary at 60 (boundary values)', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      await seedDays(itineraryId, 60);

      const response = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      expect(errorDetails(response.body)).toContain('days');

      const detail = await testApp
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie);
      expect(detail.body.dayCount).toBe(60);
    });

    it('rejects fields the client does not own', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);

      for (const body of [
        { cityId: 'cairo', dayNumber: 3 },
        { cityId: 'cairo', date: '2027-01-01' },
        { cityId: 'cairo', activities: [] },
      ]) {
        const response = await testApp
          .http()
          .post(`/api/itineraries/${itineraryId}/days`)
          .set('Cookie', owner.cookie)
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
    });

    it('rejects notes longer than 2000 characters', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);

      const response = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo', notes: 'n'.repeat(2001) });

      expect(response.status).toBe(400);
      expect(errorDetails(response.body)).toContain('notes');
    });

    it('accepts 2000 emoji characters and rejects 2001 as notes', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);

      const accepted = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo', notes: '\u{1F525}'.repeat(2000) });

      expect(accepted.status).toBe(201);
      expect(accepted.body).toMatchObject({
        cityId: 'cairo',
        notes: '\u{1F525}'.repeat(2000),
      });

      const rejected = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo', notes: '\u{1F525}'.repeat(2001) });

      expect(rejected.status).toBe(400);
      expect(errorDetails(rejected.body)).toContain('notes');
    });

    it('returns 404 for another user’s itinerary and 400 for a malformed ID', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const intruder = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);

      const foreign = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', intruder.cookie)
        .send({ cityId: 'cairo' });
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe(ErrorCode.NotFound);

      const malformed = await testApp
        .http()
        .post('/api/itineraries/not-an-id/days')
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo' });
      expect(malformed.status).toBe(400);
      expect(malformed.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('PATCH /api/itineraries/:id/days/:dayId (ITN-05)', () => {
    async function addDay(
      itineraryId: string,
      cookie: string,
      body: Record<string, unknown>,
    ): Promise<string> {
      const response = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', cookie)
        .send(body);
      return response.body._id as string;
    }

    it('edits a day’s city and notes and keeps the numbering', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const dayId = await addDay(itineraryId, owner.cookie, {
        cityId: 'cairo',
        notes: 'Arrival',
      });

      const response = await testApp
        .http()
        .patch(`/api/itineraries/${itineraryId}/days/${dayId}`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'dubai', notes: 'Moved to Dubai' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        _id: dayId,
        dayNumber: 1,
        date: '2027-04-01',
        cityId: 'dubai',
        notes: 'Moved to Dubai',
      });

      const detail = await testApp
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie);
      expect(detail.body.cityGroups).toEqual([
        expect.objectContaining({ cityId: 'dubai', fromDay: 1, toDay: 1 }),
      ]);
    });

    it('leaves omitted fields unchanged and accepts an empty body', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const dayId = await addDay(itineraryId, owner.cookie, {
        cityId: 'cairo',
        notes: 'Arrival',
      });

      const notesOnly = await testApp
        .http()
        .patch(`/api/itineraries/${itineraryId}/days/${dayId}`)
        .set('Cookie', owner.cookie)
        .send({ notes: 'Late arrival' });
      expect(notesOnly.status).toBe(200);
      expect(notesOnly.body).toMatchObject({
        cityId: 'cairo',
        notes: 'Late arrival',
      });

      const empty = await testApp
        .http()
        .patch(`/api/itineraries/${itineraryId}/days/${dayId}`)
        .set('Cookie', owner.cookie)
        .send({});
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual(notesOnly.body);
    });

    it('rejects an unknown city and over-long notes with 400', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const dayId = await addDay(itineraryId, owner.cookie, {
        cityId: 'cairo',
      });

      for (const [body, field] of [
        [{ cityId: 'nowhere' }, 'cityId'],
        [{ notes: 'n'.repeat(2001) }, 'notes'],
        [{ dayNumber: 2 }, 'dayNumber'],
      ] as const) {
        const response = await testApp
          .http()
          .patch(`/api/itineraries/${itineraryId}/days/${dayId}`)
          .set('Cookie', owner.cookie)
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
        expect(errorDetails(response.body)).toContain(field);
      }
    });

    it('returns 404 for a foreign itinerary, an unknown day and a day of another itinerary', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const intruder = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const otherId = await createOwnedItinerary(owner.cookie);
      const dayId = await addDay(itineraryId, owner.cookie, {
        cityId: 'cairo',
      });
      const otherDayId = await addDay(otherId, owner.cookie, {
        cityId: 'dubai',
      });

      for (const [id, day, cookie] of [
        [itineraryId, dayId, intruder.cookie],
        [itineraryId, new Types.ObjectId().toHexString(), owner.cookie],
        [itineraryId, otherDayId, owner.cookie],
      ] as const) {
        const response = await testApp
          .http()
          .patch(`/api/itineraries/${id}/days/${day}`)
          .set('Cookie', cookie)
          .send({ cityId: 'dubai' });

        expect(response.status).toBe(404);
        expect(response.body.code).toBe(ErrorCode.NotFound);
      }
    });

    it('rejects malformed itinerary and day IDs with 400', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const dayId = await addDay(itineraryId, owner.cookie, {
        cityId: 'cairo',
      });

      for (const [id, day] of [
        ['not-an-id', dayId],
        [itineraryId, 'not-an-id'],
      ]) {
        const response = await testApp
          .http()
          .patch(`/api/itineraries/${id}/days/${day}`)
          .set('Cookie', owner.cookie)
          .send({ cityId: 'dubai' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
    });
  });

  describe('DELETE /api/itineraries/:id/days/:dayId (ITN-07)', () => {
    it('deletes the day with its activities, budgets and transport costs and recalculates the rest', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const seeded = await seedTrip(itineraryId);
      const [first, middle, last] = seeded.dayIds;

      const response = await testApp
        .http()
        .delete(`/api/itineraries/${itineraryId}/days/${middle}`)
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(204);
      expect(response.text).toBe('');

      const detail = await testApp
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie);
      expect(detail.status).toBe(200);
      expect(detail.body.dayCount).toBe(2);
      expect(detail.body.days.map((day: { _id: string }) => day._id)).toEqual([
        first,
        last,
      ]);
      expect(
        detail.body.days.map((day: { dayNumber: number }) => day.dayNumber),
      ).toEqual([1, 2]);
      expect(detail.body.days.map((day: { date: string }) => day.date)).toEqual(
        ['2027-04-01', '2027-04-02'],
      );
      expect(detail.body.cityGroups).toEqual([
        {
          cityId: 'cairo',
          fromDay: 1,
          toDay: 2,
          dayCount: 2,
          checkIn: '2027-04-01',
          checkOut: '2027-04-03',
        },
      ]);
      expect(
        detail.body.transportCosts.map((cost: { dayId: string }) => cost.dayId),
      ).toEqual([first, last]);

      const stored = await itineraryModel.findById(itineraryId).lean().exec();
      expect(stored?.days).toHaveLength(2);
      expect(stored?.days.flatMap((day) => day.activities)).toHaveLength(2);
      expect(stored?.days.flatMap((day) => day.budgetEntries)).toHaveLength(2);
      expect(stored?.transportCosts).toHaveLength(2);
      expect(stored?.cityIds).toEqual(['cairo']);

      const repeated = await testApp
        .http()
        .delete(`/api/itineraries/${itineraryId}/days/${middle}`)
        .set('Cookie', owner.cookie);
      expect(repeated.status).toBe(404);
      expect(repeated.body.code).toBe(ErrorCode.NotFound);
    });

    it('returns 404 for a foreign itinerary, an unknown day and a day of another itinerary', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const intruder = await loginAs(testApp.connection, UserRole.USER);
      const admin = await loginAs(testApp.connection, UserRole.ADMIN);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const otherId = await createOwnedItinerary(owner.cookie);
      const seeded = await seedTrip(itineraryId);
      const otherSeeded = await seedTrip(otherId, ['dubai']);

      for (const [id, day, cookie] of [
        [itineraryId, seeded.dayIds[0], intruder.cookie],
        [itineraryId, seeded.dayIds[0], admin.cookie],
        [itineraryId, new Types.ObjectId().toHexString(), owner.cookie],
        [itineraryId, otherSeeded.dayIds[0], owner.cookie],
      ] as const) {
        const response = await testApp
          .http()
          .delete(`/api/itineraries/${id}/days/${day}`)
          .set('Cookie', cookie);

        expect(response.status).toBe(404);
        expect(response.body.code).toBe(ErrorCode.NotFound);
      }

      expect(
        await itineraryModel
          .countDocuments({ 'days._id': new Types.ObjectId(seeded.dayIds[0]) })
          .exec(),
      ).toBe(1);
    });

    it('rejects malformed itinerary and day IDs with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const seeded = await seedTrip(itineraryId);

      for (const [id, day] of [
        ['not-an-id', seeded.dayIds[0]],
        [itineraryId, 'not-an-id'],
      ] as const) {
        const response = await testApp
          .http()
          .delete(`/api/itineraries/${id}/days/${day}`)
          .set('Cookie', owner.cookie);

        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
    });
  });

  describe('PATCH /api/itineraries/:id/days/reorder (ITN-08)', () => {
    it('reorders the days and returns the itinerary with numbers, dates and groups recalculated', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const seeded = await seedTrip(itineraryId);
      const [first, middle, last] = seeded.dayIds;

      const response = await testApp
        .http()
        .patch(`/api/itineraries/${itineraryId}/days/reorder`)
        .set('Cookie', owner.cookie)
        .send({ dayIds: [last, first, middle] });

      expect(response.status).toBe(200);
      expect(response.body.days.map((day: { _id: string }) => day._id)).toEqual(
        [last, first, middle],
      );
      expect(
        response.body.days.map((day: { dayNumber: number }) => day.dayNumber),
      ).toEqual([1, 2, 3]);
      expect(
        response.body.days.map((day: { cityId: string }) => day.cityId),
      ).toEqual(['cairo', 'cairo', 'dubai']);
      expect(response.body.cityGroups).toEqual([
        {
          cityId: 'cairo',
          fromDay: 1,
          toDay: 2,
          dayCount: 2,
          checkIn: '2027-04-01',
          checkOut: '2027-04-03',
        },
        {
          cityId: 'dubai',
          fromDay: 3,
          toDay: 3,
          dayCount: 1,
          checkIn: '2027-04-03',
          checkOut: '2027-04-04',
        },
      ]);
      expect(
        response.body.transportCosts.map((cost: { _id: string }) => cost._id),
      ).toEqual(seeded.costIds);

      const stored = await itineraryModel.findById(itineraryId).lean().exec();
      expect(stored?.cityIds).toEqual(['cairo', 'dubai']);
      expect(stored?.dayCount).toBe(3);
    });

    it('treats the current order as a no-op', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const seeded = await seedTrip(itineraryId);
      const before = (await itineraryModel
        .findById(itineraryId)
        .lean()
        .exec()) as { updatedAt: Date } | null;

      const response = await testApp
        .http()
        .patch(`/api/itineraries/${itineraryId}/days/reorder`)
        .set('Cookie', owner.cookie)
        .send({ dayIds: seeded.dayIds });

      expect(response.status).toBe(200);
      const after = (await itineraryModel
        .findById(itineraryId)
        .lean()
        .exec()) as { updatedAt: Date } | null;
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
    });

    it('rejects anything that is not a permutation of the current day IDs with 400 on dayIds', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const seeded = await seedTrip(itineraryId);
      const [first, middle, last] = seeded.dayIds;
      const unknown = new Types.ObjectId().toHexString();

      const invalid = [
        {},
        { dayIds: 'not-a-list' },
        { dayIds: [] },
        { dayIds: [first, middle] },
        { dayIds: [first, middle, last, unknown] },
        { dayIds: [first, middle, middle] },
        { dayIds: [first, middle, unknown] },
        { dayIds: [first, middle, 42] },
        { dayIds: [first, middle, 'not-an-id'] },
      ];

      for (const body of invalid) {
        const response = await testApp
          .http()
          .patch(`/api/itineraries/${itineraryId}/days/reorder`)
          .set('Cookie', owner.cookie)
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
        expect(mentionsDayIds(response.body)).toBe(true);
      }

      const stored = await itineraryModel.findById(itineraryId).lean().exec();
      expect(stored?.days.map((day) => day._id.toHexString())).toEqual(
        seeded.dayIds,
      );
    });

    it('rejects fields the client does not own', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const seeded = await seedTrip(itineraryId);

      const response = await testApp
        .http()
        .patch(`/api/itineraries/${itineraryId}/days/reorder`)
        .set('Cookie', owner.cookie)
        .send({ dayIds: seeded.dayIds, dayCount: 2 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    });

    it('returns 404 for a foreign itinerary and for an unknown one', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const intruder = await loginAs(testApp.connection, UserRole.USER);
      const admin = await loginAs(testApp.connection, UserRole.ADMIN);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const seeded = await seedTrip(itineraryId);

      for (const [id, cookie] of [
        [itineraryId, intruder.cookie],
        [itineraryId, admin.cookie],
        [new Types.ObjectId().toHexString(), owner.cookie],
      ] as const) {
        const response = await testApp
          .http()
          .patch(`/api/itineraries/${id}/days/reorder`)
          .set('Cookie', cookie)
          .send({ dayIds: seeded.dayIds });

        expect(response.status).toBe(404);
        expect(response.body.code).toBe(ErrorCode.NotFound);
      }
    });

    it('rejects a malformed itinerary ID with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);

      const response = await testApp
        .http()
        .patch('/api/itineraries/not-an-id/days/reorder')
        .set('Cookie', owner.cookie)
        .send({ dayIds: [] });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('concurrent day writes (ITN-05 review)', () => {
    it('keeps every day when ten adds overlap', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, index) =>
          testApp
            .http()
            .post(`/api/itineraries/${itineraryId}/days`)
            .set('Cookie', owner.cookie)
            .send({ cityId: 'cairo', notes: `day-${index}` }),
        ),
      );

      let successes = 0;
      for (const result of results) {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') {
          expect(result.value.status).toBe(201);
          successes += 1;
        }
      }
      expect(successes).toBe(10);

      const stored = await itineraryModel.findById(itineraryId).lean().exec();
      expect(stored?.days).toHaveLength(successes);
      expect(stored?.dayCount).toBe(successes);
      expect(new Set(stored?.days.map((day) => day.notes)).size).toBe(10);
    });

    it('stops cleanly at the 60-day cap when more adds race past it', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      await seedDays(itineraryId, 57);

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          testApp
            .http()
            .post(`/api/itineraries/${itineraryId}/days`)
            .set('Cookie', owner.cookie)
            .send({ cityId: 'cairo', notes: `day-${index}` }),
        ),
      );

      let successes = 0;
      let failures = 0;
      for (const result of results) {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled' && result.value.status === 201) {
          successes += 1;
        } else {
          failures += 1;
        }
      }
      expect(successes).toBe(3);
      expect(failures).toBe(5);

      const stored = await itineraryModel.findById(itineraryId).lean().exec();
      expect(stored?.days).toHaveLength(60);
      expect(stored?.dayCount).toBe(60);
    });

    it('keeps both an add and a day edit when they overlap', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const first = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo', notes: 'original' });
      const firstId = first.body._id as string;

      const results = await Promise.allSettled([
        testApp
          .http()
          .post(`/api/itineraries/${itineraryId}/days`)
          .set('Cookie', owner.cookie)
          .send({ cityId: 'dubai', notes: 'second' }),
        testApp
          .http()
          .patch(`/api/itineraries/${itineraryId}/days/${firstId}`)
          .set('Cookie', owner.cookie)
          .send({ notes: 'edited' }),
      ]);

      for (const result of results) expect(result.status).toBe('fulfilled');

      const detail = await testApp
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie);
      expect(detail.body.days).toHaveLength(2);
      expect(
        detail.body.days.map((day: { notes: string }) => day.notes),
      ).toEqual(expect.arrayContaining(['edited', 'second']));
    });
  });

  describe('activities (ITN-10)', () => {
    async function ownedDay() {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const itineraryId = await createOwnedItinerary(owner.cookie);
      const day = await testApp
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo', notes: 'Arrival' })
        .expect(201);
      const dayId = day.body._id as string;
      return {
        owner,
        itineraryId,
        dayId,
        path: `/api/itineraries/${itineraryId}/days/${dayId}/activities`,
      };
    }

    it('adds a trimmed activity with zero cost in a supported currency and persists it', async () => {
      const { owner, itineraryId, path } = await ownedDay();
      const response = await testApp
        .http()
        .post(path)
        .set('Cookie', owner.cookie)
        .send({
          name: '  Free museum  ',
          description: '$100 is not the admission price',
          time: '00:00',
          cost: { amountMinor: 0, currency: 'JPY' },
        })
        .expect(201);
      expect(response.body.activities).toEqual([
        {
          _id: expect.stringMatching(/^[0-9a-f]{24}$/),
          name: 'Free museum',
          description: '$100 is not the admission price',
          time: '00:00',
          cost: { amountMinor: 0, currency: 'JPY' },
          images: [],
        },
      ]);
      const detail = await testApp
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(detail.body.days[0].activities).toEqual(response.body.activities);
      expect(detail.body).toMatchObject({ dayCount: 1 });
    });

    it('accepts name and time boundaries and omits fields that were not supplied', async () => {
      const { owner, path } = await ownedDay();
      const first = await testApp
        .http()
        .post(path)
        .set('Cookie', owner.cookie)
        .send({ name: 'A' })
        .expect(201);
      expect(first.body.activities[0]).toEqual({
        _id: expect.any(String),
        name: 'A',
        images: [],
      });
      const second = await testApp
        .http()
        .post(path)
        .set('Cookie', owner.cookie)
        .send({
          name: 'N'.repeat(100),
          description: 'D'.repeat(1000),
          time: '23:59',
          cost: { amountMinor: 2500, currency: 'USD' },
        })
        .expect(201);
      expect(second.body.activities[1]).toMatchObject({
        name: 'N'.repeat(100),
        description: 'D'.repeat(1000),
        time: '23:59',
        cost: { amountMinor: 2500, currency: 'USD' },
      });
    });

    it('edits only supplied activity fields and deletes only the addressed activity', async () => {
      const { owner, itineraryId, path } = await ownedDay();
      const added = await testApp
        .http()
        .post(path)
        .set('Cookie', owner.cookie)
        .send({
          name: 'Original',
          description: 'Keep',
          time: '09:30',
          cost: { amountMinor: 2000, currency: 'EGP' },
        })
        .expect(201);
      const id = added.body.activities[0]._id as string;
      await testApp
        .http()
        .post(path)
        .set('Cookie', owner.cookie)
        .send({ name: 'Other activity' })
        .expect(201);
      const edited = await testApp
        .http()
        .patch(`/api/activities/${id}`)
        .set('Cookie', owner.cookie)
        .send({ name: '  $$ROOT  ', cost: { amountMinor: 0, currency: 'USD' } })
        .expect(200);
      expect(edited.body).toEqual({
        _id: id,
        name: '$$ROOT',
        description: 'Keep',
        time: '09:30',
        cost: { amountMinor: 0, currency: 'USD' },
        images: [],
      });
      const unchanged = await testApp
        .http()
        .patch(`/api/activities/${id}`)
        .set('Cookie', owner.cookie)
        .send({})
        .expect(200);
      expect(unchanged.body).toEqual(edited.body);
      const deleted = await testApp
        .http()
        .delete(`/api/activities/${id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      expect(deleted.text).toBe('');
      const detail = await testApp
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(detail.body.days[0]).toMatchObject({
        notes: 'Arrival',
        activities: [{ name: 'Other activity' }],
      });
      const repeated = await testApp
        .http()
        .delete(`/api/activities/${id}`)
        .set('Cookie', owner.cookie)
        .expect(404);
      expect(repeated.body.code).toBe(ErrorCode.NotFound);
    });

    it('rejects invalid input with field details and leaves stored activities unchanged', async () => {
      const { owner, itineraryId, path } = await ownedDay();
      const added = await testApp
        .http()
        .post(path)
        .set('Cookie', owner.cookie)
        .send({ name: 'Keep' })
        .expect(201);
      const id = added.body.activities[0]._id as string;
      const invalid = [
        { name: '' },
        { name: '   ' },
        { name: 'N'.repeat(101) },
        { name: null },
        { description: 'D'.repeat(1001) },
        { description: null },
        { time: '24:00' },
        { time: '09:60' },
        { time: null },
        { cost: 20 },
        { cost: null },
        { cost: { amountMinor: -1, currency: 'USD' } },
        { cost: { amountMinor: 1.5, currency: 'USD' } },
        { cost: { amountMinor: 1, currency: 'ZZZ' } },
        { cost: { amountMinor: 1 } },
        { cost: { amountMinor: 1, currency: 'USD', unknown: true } },
        { unknown: true },
      ];
      for (const fields of invalid) {
        const created = await testApp
          .http()
          .post(path)
          .set('Cookie', owner.cookie)
          .send({ name: 'Valid', ...fields })
          .expect(400);
        const updated = await testApp
          .http()
          .patch(`/api/activities/${id}`)
          .set('Cookie', owner.cookie)
          .send(fields)
          .expect(400);
        for (const response of [created, updated]) {
          expect(response.body.code).toBe(ErrorCode.ValidationFailed);
          const field = Object.keys(fields)[0];
          expect(
            errorDetails(response.body).some(
              (detail) => detail === field || detail.startsWith(`${field}.`),
            ),
          ).toBe(true);
        }
      }
      const detail = await testApp
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(detail.body.days[0].activities).toEqual(added.body.activities);
    });

    it('requires authentication and returns 404 for missing or foreign parents and activities', async () => {
      const { owner, itineraryId, dayId, path } = await ownedDay();
      const added = await testApp
        .http()
        .post(path)
        .set('Cookie', owner.cookie)
        .send({ name: 'Owned' })
        .expect(201);
      const id = added.body.activities[0]._id as string;
      const foreign = await loginAs(testApp.connection, UserRole.ADMIN);
      const missing = new Types.ObjectId().toHexString();
      for (const cookie of [undefined, foreign.cookie]) {
        const responses = await Promise.all([
          testApp
            .http()
            .post(path)
            .set('Cookie', cookie ?? '')
            .send({ name: 'New' }),
          testApp
            .http()
            .patch(`/api/activities/${id}`)
            .set('Cookie', cookie ?? '')
            .send({ name: 'New' }),
          testApp
            .http()
            .delete(`/api/activities/${id}`)
            .set('Cookie', cookie ?? ''),
        ]);
        for (const response of responses) {
          expect(response.status).toBe(cookie ? 404 : 401);
          expect(response.body.code).toBe(
            cookie ? ErrorCode.NotFound : ErrorCode.NotAuthenticated,
          );
        }
      }
      const responses = await Promise.all([
        testApp
          .http()
          .post(`/api/itineraries/${missing}/days/${dayId}/activities`)
          .set('Cookie', owner.cookie)
          .send({ name: 'New' }),
        testApp
          .http()
          .post(`/api/itineraries/${itineraryId}/days/${missing}/activities`)
          .set('Cookie', owner.cookie)
          .send({ name: 'New' }),
        testApp
          .http()
          .patch(`/api/activities/${missing}`)
          .set('Cookie', owner.cookie)
          .send({ name: 'New' }),
        testApp
          .http()
          .patch(`/api/activities/${missing}`)
          .set('Cookie', owner.cookie)
          .send({}),
        testApp
          .http()
          .delete(`/api/activities/${missing}`)
          .set('Cookie', owner.cookie),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(response.body.code).toBe(ErrorCode.NotFound);
      }
    });

    it('rejects malformed route IDs with 400 VALIDATION_FAILED', async () => {
      const { owner, itineraryId, dayId } = await ownedDay();
      const responses = await Promise.all([
        testApp
          .http()
          .post(`/api/itineraries/bad/days/${dayId}/activities`)
          .set('Cookie', owner.cookie)
          .send({ name: 'New' }),
        testApp
          .http()
          .post(`/api/itineraries/${itineraryId}/days/bad/activities`)
          .set('Cookie', owner.cookie)
          .send({ name: 'New' }),
        testApp
          .http()
          .patch('/api/activities/bad')
          .set('Cookie', owner.cookie)
          .send({ name: 'New' }),
        testApp
          .http()
          .delete('/api/activities/bad')
          .set('Cookie', owner.cookie),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
    });

    it('documents the required activity routes, money shape and cookie authentication in Swagger', () => {
      const document = SwaggerModule.createDocument(
        testApp.app,
        new DocumentBuilder().addCookieAuth('access_token').build(),
      );
      for (const [path, method] of [
        ['/api/itineraries/{id}/days/{dayId}/activities', 'post'],
        ['/api/activities/{id}', 'patch'],
        ['/api/activities/{id}', 'delete'],
      ] as const) {
        expect(document.paths[path]?.[method]?.summary).toContain('ITN-10');
        expect(document.paths[path]?.[method]?.security).toEqual([
          { cookie: [] },
        ]);
      }
      expect(document.components?.schemas?.ActivityCostDto).toMatchObject({
        required: ['amountMinor', 'currency'],
      });
    });
  });

  describe('GET /api/itineraries/:id/hotels (ITN-25)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const id = new Types.ObjectId().toHexString();
      const response = await testApp
        .http()
        .get(`/api/itineraries/${id}/hotels?groupIndex=0&guests=1`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
    });

    it('returns 404 for a foreign or missing itinerary', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const other = await loginAs(testApp.connection, UserRole.USER);
      const id = await createOwnedItinerary(owner.cookie);
      await testApp
        .http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo' });

      const foreign = await testApp
        .http()
        .get(`/api/itineraries/${id}/hotels?groupIndex=0&guests=1`)
        .set('Cookie', other.cookie);
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe(ErrorCode.NotFound);

      const missing = await testApp
        .http()
        .get(
          `/api/itineraries/${new Types.ObjectId().toHexString()}/hotels?groupIndex=0&guests=1`,
        )
        .set('Cookie', owner.cookie);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe(ErrorCode.NotFound);
    });

    it('rejects malformed ids and query parameters with 400', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const id = await createOwnedItinerary(owner.cookie);

      const badId = await testApp
        .http()
        .get(`/api/itineraries/not-an-id/hotels?groupIndex=0&guests=1`)
        .set('Cookie', owner.cookie);
      expect(badId.status).toBe(400);
      expect(badId.body.code).toBe(ErrorCode.ValidationFailed);

      for (const query of [
        'groupIndex=abc&guests=1',
        'groupIndex=-1&guests=1',
        'groupIndex=0',
        'groupIndex=0&guests=0',
        'groupIndex=0&guests=1&rooms=0',
      ]) {
        const bad = await testApp
          .http()
          .get(`/api/itineraries/${id}/hotels?${query}`)
          .set('Cookie', owner.cookie);
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe(ErrorCode.ValidationFailed);
      }
    });

    it('returns an empty page for a valid city group and registers in Swagger', async () => {
      const owner = await loginAs(testApp.connection, UserRole.USER);
      const id = await createOwnedItinerary(owner.cookie);
      await testApp
        .http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId: 'cairo' });

      const response = await testApp
        .http()
        .get(`/api/itineraries/${id}/hotels?groupIndex=0&guests=2&rooms=1`)
        .set('Cookie', owner.cookie);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });

      const outOfRange = await testApp
        .http()
        .get(`/api/itineraries/${id}/hotels?groupIndex=5&guests=1`)
        .set('Cookie', owner.cookie);
      expect(outOfRange.status).toBe(404);
      expect(outOfRange.body.code).toBe(ErrorCode.NotFound);
    });
  });
});
