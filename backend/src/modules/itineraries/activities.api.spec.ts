import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { loginAs, type LoggedInUser } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ItinerariesModule } from './itineraries.module.js';

const itineraryBody = {
  title: 'Cairo days',
  countryCodes: ['EG'],
  startDate: '2027-04-01',
};

const activityBody = {
  name: '  Pyramids of Giza  ',
  description: 'Guided tour',
  time: '09:30',
  cost: { amountMinor: 2000, currency: 'EGP' },
};

function fields(body: { details?: { field: string }[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field);
}

describe('ITN-10 activity HTTP API', () => {
  let testApp: TestApp;
  const referenceData = new FakeReferenceDataService();

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [ItinerariesModule],
      override: (builder) =>
        builder.overrideProvider(ReferenceDataService).useValue(referenceData),
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(testApp.connection);
  });

  afterAll(async () => {
    await testApp.close();
  }, HOOK_TIMEOUT);

  async function newTrip(user: LoggedInUser): Promise<{
    itineraryId: string;
    dayId: string;
  }> {
    const created = await testApp
      .http()
      .post('/api/itineraries')
      .set('Cookie', user.cookie)
      .send(itineraryBody);
    const day = await testApp
      .http()
      .post(`/api/itineraries/${created.body._id}/days`)
      .set('Cookie', user.cookie)
      .send({ cityId: 'cairo' });
    return {
      itineraryId: created.body._id as string,
      dayId: day.body._id as string,
    };
  }

  async function addActivity(
    trip: { itineraryId: string; dayId: string },
    user: LoggedInUser,
    body: object = activityBody,
  ) {
    return testApp
      .http()
      .post(
        `/api/itineraries/${trip.itineraryId}/days/${trip.dayId}/activities`,
      )
      .set('Cookie', user.cookie)
      .send(body);
  }

  it('registers the three activity routes in Swagger with ITN-10 summaries and auth', () => {
    const document = SwaggerModule.createDocument(
      testApp.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );

    const add = document.paths['/api/itineraries/{id}/days/{dayId}/activities'];
    const edit = document.paths['/api/activities/{id}'];
    expect(add?.post).toBeDefined();
    expect(edit?.patch).toBeDefined();
    expect(edit?.delete).toBeDefined();
    expect(add?.post?.summary).toContain('ITN-10');
    expect(edit?.patch?.summary).toContain('ITN-10');
    expect(edit?.delete?.summary).toContain('ITN-10');
    expect(add?.post?.security).toBeDefined();
    expect(edit?.patch?.security).toBeDefined();
    expect(edit?.delete?.security).toBeDefined();
    expect(document.components?.schemas?.ItineraryDayResponseDto).toBeDefined();
  });

  it('rejects all three routes without a session (401 NOT_AUTHENTICATED)', async () => {
    const id = new Types.ObjectId().toHexString();
    const responses = await Promise.all([
      testApp
        .http()
        .post(`/api/itineraries/${id}/days/${id}/activities`)
        .send(activityBody),
      testApp.http().patch(`/api/activities/${id}`).send({ name: 'New' }),
      testApp.http().delete(`/api/activities/${id}`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
    }
  });

  it('adds an activity with every field and returns the day with derived values', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);

    const response = await addActivity(trip, owner);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      _id: trip.dayId,
      dayNumber: 1,
      date: '2027-04-01',
      cityId: 'cairo',
      activities: [
        {
          name: 'Pyramids of Giza',
          description: 'Guided tour',
          time: '09:30',
          cost: { amountMinor: 2000, currency: 'EGP' },
          images: [],
        },
      ],
      budgetEntries: [],
    });
    expect(response.body.activities[0]._id).toMatch(/^[0-9a-f]{24}$/);
  });

  it('adds an activity with only a name (optional fields stay absent)', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);

    const response = await addActivity(trip, owner, { name: 'Coffee break' });

    expect(response.status).toBe(201);
    expect(response.body.activities[0]).toMatchObject({
      name: 'Coffee break',
      images: [],
    });
    expect(response.body.activities[0]).not.toHaveProperty('description');
    expect(response.body.activities[0]).not.toHaveProperty('time');
    expect(response.body.activities[0]).not.toHaveProperty('cost');
  });

  it('stores a $-prefixed name verbatim, not as a MongoDB expression', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);

    const response = await addActivity(trip, owner, {
      name: '$100 for dinner',
    });

    expect(response.status).toBe(201);
    expect(response.body.activities[0].name).toBe('$100 for dinner');
  });

  it('returns 404 for another user’s itinerary/day and a missing day', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const other = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);

    const foreign = await addActivity(trip, other);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe(ErrorCode.NotFound);

    const missing = await testApp
      .http()
      .post(
        `/api/itineraries/${trip.itineraryId}/days/${new Types.ObjectId().toHexString()}/activities`,
      )
      .set('Cookie', owner.cookie)
      .send(activityBody);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe(ErrorCode.NotFound);
  });

  it('rejects invalid activity fields and unknown fields with 400 VALIDATION_FAILED', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);

    const cases: object[] = [
      {},
      { name: '' },
      { name: 'x'.repeat(101) },
      { name: 'Tour', description: 'd'.repeat(1001) },
      { name: 'Tour', time: '25:00' },
      { name: 'Tour', cost: { amountMinor: -1, currency: 'EGP' } },
      { name: 'Tour', cost: { amountMinor: 10.5, currency: 'EGP' } },
      { name: 'Tour', cost: { amountMinor: 10, currency: 'XXX' } },
      { name: 'Tour', images: [] },
    ];
    for (const body of cases) {
      const response = await addActivity(trip, owner, body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      expect(fields(response.body).length).toBeGreaterThan(0);
    }
  });

  it('rejects a malformed itinerary/day ID with 400 VALIDATION_FAILED', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const response = await testApp
      .http()
      .post('/api/itineraries/not-an-id/days/also-bad/activities')
      .set('Cookie', owner.cookie)
      .send(activityBody);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it('edits an activity partially and keeps the omitted fields', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);
    const added = await addActivity(trip, owner);
    const activityId = added.body.activities[0]._id as string;

    const response = await testApp
      .http()
      .patch(`/api/activities/${activityId}`)
      .set('Cookie', owner.cookie)
      .send({ time: '14:00' });

    expect(response.status).toBe(200);
    expect(response.body.activities[0]).toMatchObject({
      name: 'Pyramids of Giza',
      description: 'Guided tour',
      time: '14:00',
      cost: { amountMinor: 2000, currency: 'EGP' },
    });
  });

  it('an empty edit leaves the activity and updatedAt unchanged', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);
    const added = await addActivity(trip, owner);
    const activityId = added.body.activities[0]._id as string;

    const response = await testApp
      .http()
      .patch(`/api/activities/${activityId}`)
      .set('Cookie', owner.cookie)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.activities[0]).toEqual(added.body.activities[0]);
  });

  it('rejects an edit of another user’s activity with 404 and a bad edit with 400', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const other = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);
    const added = await addActivity(trip, owner);
    const activityId = added.body.activities[0]._id as string;

    const foreign = await testApp
      .http()
      .patch(`/api/activities/${activityId}`)
      .set('Cookie', other.cookie)
      .send({ name: 'Stolen' });
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe(ErrorCode.NotFound);

    const invalid = await testApp
      .http()
      .patch(`/api/activities/${activityId}`)
      .set('Cookie', owner.cookie)
      .send({ cost: { amountMinor: -5, currency: 'EGP' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe(ErrorCode.ValidationFailed);

    const unchanged = await testApp
      .http()
      .get(`/api/itineraries/${trip.itineraryId}`)
      .set('Cookie', owner.cookie);
    expect(unchanged.body.days[0].activities[0].name).toBe('Pyramids of Giza');
  });

  it('deletes an activity (204), and a second delete or a foreign delete is 404', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const other = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);
    const added = await addActivity(trip, owner);
    const activityId = added.body.activities[0]._id as string;

    const foreign = await testApp
      .http()
      .delete(`/api/activities/${activityId}`)
      .set('Cookie', other.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe(ErrorCode.NotFound);

    const deleted = await testApp
      .http()
      .delete(`/api/activities/${activityId}`)
      .set('Cookie', owner.cookie);
    expect(deleted.status).toBe(204);

    const detail = await testApp
      .http()
      .get(`/api/itineraries/${trip.itineraryId}`)
      .set('Cookie', owner.cookie);
    expect(detail.body.days[0].activities).toEqual([]);

    const repeated = await testApp
      .http()
      .delete(`/api/activities/${activityId}`)
      .set('Cookie', owner.cookie);
    expect(repeated.status).toBe(404);
    expect(repeated.body.code).toBe(ErrorCode.NotFound);
  });

  it('keeps both activities when two adds land at the same time', async () => {
    const owner = await loginAs(testApp.connection, UserRole.USER);
    const trip = await newTrip(owner);

    const results = await Promise.allSettled([
      addActivity(trip, owner, { name: 'First' }),
      addActivity(trip, owner, { name: 'Second' }),
    ]);
    for (const result of results) expect(result.status).toBe('fulfilled');

    const detail = await testApp
      .http()
      .get(`/api/itineraries/${trip.itineraryId}`)
      .set('Cookie', owner.cookie);
    expect(detail.body.days[0].activities).toHaveLength(2);
    expect(
      detail.body.days[0].activities.map(
        (activity: { name: string }) => activity.name,
      ),
    ).toEqual(expect.arrayContaining(['First', 'Second']));
  });
});
