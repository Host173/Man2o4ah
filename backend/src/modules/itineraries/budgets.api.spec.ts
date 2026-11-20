import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Model } from 'mongoose';
import { FakeFxService } from '../../../test/fakes/fx.fake.js';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { User, UserRole } from '../accounts/schemas/user.schema.js';
import { FxService } from '../fx/fx.service.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { ItinerariesModule } from './itineraries.module.js';
import { BudgetCategory, TransportMode } from './schemas/itinerary.schema.js';

/**
 * HTTP contract of ITN-14 (budget entries) and ITN-18 (converted summary).
 * Written before the implementation: every test in this file fails with 404
 * until the routes exist (TDD, see docs/ai/skills/travel-platform/references/testing.md §2).
 */
describe('Budgets and budget summary HTTP API (ITN-14, ITN-18)', () => {
  let t: TestApp;
  let cookie: string;
  let userId: string;
  let itineraryId: string;
  let dayIds: string[];
  const referenceData = new FakeReferenceDataService();
  const fx = new FakeFxService({
    rates: { USD: 1, EGP: 50, EUR: 5, JPY: 100 },
    minorUnits: { JPY: 0 },
    rateDate: '2026-11-01',
  });

  beforeAll(async () => {
    t = await createTestApp({
      imports: [ItinerariesModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(referenceData)
          .overrideProvider(FxService)
          .useValue(fx),
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    const user = await loginAs(t.connection, UserRole.USER);
    cookie = user.cookie;
    userId = user.id;
    const users = t.moduleRef.get<Model<User>>(getModelToken(User.name));
    await users.findByIdAndUpdate(userId, { preferredCurrency: 'EGP' });

    const itinerary = await t
      .http()
      .post('/api/itineraries')
      .set('Cookie', cookie)
      .send({
        title: 'Budget trip',
        countryCodes: ['EG'],
        startDate: '2027-04-01',
      })
      .expect(201);
    itineraryId = itinerary.body._id;
    dayIds = [];
    for (const cityId of ['cairo', 'cairo', 'dubai']) {
      const day = await t
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', cookie)
        .send({ cityId })
        .expect(201);
      dayIds.push(day.body._id);
    }
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  function addBudget(dayId: string, input: object = {}, session = cookie) {
    return t
      .http()
      .post(`/api/itineraries/${itineraryId}/days/${dayId}/budgets`)
      .set('Cookie', session)
      .send(input);
  }

  function patchBudget(id: string, input: object, session = cookie) {
    return t
      .http()
      .patch(`/api/budgets/${id}`)
      .set('Cookie', session)
      .send(input);
  }

  function deleteBudget(id: string, session = cookie) {
    return t.http().delete(`/api/budgets/${id}`).set('Cookie', session);
  }

  function summary(session = cookie) {
    return t
      .http()
      .get(`/api/itineraries/${itineraryId}/budget-summary`)
      .set('Cookie', session);
  }

  async function getTrip(session = cookie) {
    return (
      await t
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', session)
        .expect(200)
    ).body;
  }

  /** A mixed-currency trip: EGP, EUR and JPY amounts, activity and transport costs. */
  async function seedSummaryData(): Promise<void> {
    await addBudget(dayIds[0], {
      category: BudgetCategory.FOOD,
      amountMinor: 100,
      currency: 'EGP',
      note: 'Lunch',
    }).expect(201);
    await addBudget(dayIds[0], {
      category: BudgetCategory.ACCOMMODATION,
      amountMinor: 200,
      currency: 'EUR',
    }).expect(201);
    await addBudget(dayIds[1], {
      category: BudgetCategory.IN_CITY_TRANSPORT,
      amountMinor: 500,
      currency: 'EGP',
    }).expect(201);
    await addBudget(dayIds[2], {
      category: BudgetCategory.FOOD,
      amountMinor: 100,
      currency: 'JPY',
    }).expect(201);
    await t
      .http()
      .post(`/api/itineraries/${itineraryId}/days/${dayIds[0]}/activities`)
      .set('Cookie', cookie)
      .send({ name: 'Pyramids', cost: 1000 })
      .expect(201);
    await t
      .http()
      .post(`/api/itineraries/${itineraryId}/transport-costs`)
      .set('Cookie', cookie)
      .send({
        dayId: dayIds[0],
        mode: TransportMode.TRAIN,
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amountMinor: 30000,
        currency: 'EGP',
      })
      .expect(201);
    await t
      .http()
      .post(`/api/itineraries/${itineraryId}/transport-costs`)
      .set('Cookie', cookie)
      .send({
        dayId: dayIds[2],
        mode: TransportMode.FERRY,
        fromCityId: 'dubai',
        toCityId: 'cairo',
        amountMinor: 5000,
        currency: 'EGP',
      })
      .expect(201);
  }

  const body = {
    category: BudgetCategory.FOOD,
    amountMinor: 1500,
    currency: 'EGP',
    note: 'Lunch',
  };

  it('adds, edits and deletes only the selected budget entry', async () => {
    const first = (await addBudget(dayIds[0], body).expect(201)).body;
    const second = (
      await addBudget(dayIds[1], {
        category: BudgetCategory.ACCOMMODATION,
        amountMinor: 200,
        currency: 'USD',
      }).expect(201)
    ).body;
    expect(first).toEqual({
      _id: expect.stringMatching(/^[0-9a-f]{24}$/),
      ...body,
    });
    expect(second).toEqual({
      _id: expect.stringMatching(/^[0-9a-f]{24}$/),
      category: BudgetCategory.ACCOMMODATION,
      amountMinor: 200,
      currency: 'USD',
    });
    const trip = await getTrip();
    expect(trip.days[0].budgetEntries).toEqual([first]);
    expect(trip.days[1].budgetEntries).toEqual([second]);

    const changed = (
      await patchBudget(first._id, {
        category: BudgetCategory.ACTIVITIES,
        amountMinor: 0,
        currency: 'JPY',
        note: 'Tickets',
      }).expect(200)
    ).body;
    expect(changed).toEqual({
      _id: first._id,
      category: BudgetCategory.ACTIVITIES,
      amountMinor: 0,
      currency: 'JPY',
      note: 'Tickets',
    });
    expect((await getTrip()).days[0].budgetEntries).toEqual([changed]);

    const partial = (
      await patchBudget(first._id, { amountMinor: 30 }).expect(200)
    ).body;
    expect(partial).toEqual({ ...changed, amountMinor: 30 });
    const empty = (await patchBudget(first._id, {}).expect(200)).body;
    expect(empty).toEqual(partial);

    await deleteBudget(first._id).expect(204);
    expect((await getTrip()).days[0].budgetEntries).toEqual([]);
    expect((await getTrip()).days[1].budgetEntries).toEqual([second]);
    const missing = await deleteBudget(first._id).expect(404);
    expect(missing.body.code).toBe(ErrorCode.NotFound);
  });

  it.each(Object.values(BudgetCategory))(
    'accepts the %s category and a zero amount',
    async (category) => {
      const response = await addBudget(dayIds[0], {
        ...body,
        category,
        amountMinor: 0,
      }).expect(201);
      expect(response.body).toEqual({
        _id: expect.any(String),
        ...body,
        category,
        amountMinor: 0,
      });
    },
  );

  it('preserves the largest exactly representable integer amount', async () => {
    const response = await addBudget(dayIds[0], {
      ...body,
      amountMinor: Number.MAX_SAFE_INTEGER,
    }).expect(201);
    expect(response.body.amountMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect((await getTrip()).days[0].budgetEntries[0].amountMinor).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it.each(['category', 'amountMinor', 'currency'] as const)(
    'requires %s and rejects null on create and edit',
    async (field) => {
      const incomplete: Partial<typeof body> = { ...body };
      delete incomplete[field];
      for (const input of [incomplete, { ...body, [field]: null }]) {
        const response = await addBudget(dayIds[0], input).expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
        expect(response.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
      const created = (await addBudget(dayIds[0], body).expect(201)).body;
      const patched = await patchBudget(created._id, { [field]: null }).expect(
        400,
      );
      expect(patched.body.code).toBe(ErrorCode.ValidationFailed);
      expect((await getTrip()).days[0].budgetEntries).toEqual([created]);
    },
  );

  it.each([
    ['category', 'shopping'],
    ['amountMinor', -1],
    ['amountMinor', 1.5],
    ['amountMinor', '1500'],
    ['amountMinor', Number.MAX_SAFE_INTEGER + 1],
    ['currency', 'XXX'],
    ['currency', ''],
    ['note', 'x'.repeat(201)],
  ])('rejects invalid %s = %s without mutation', async (field, value) => {
    const invalid = await addBudget(dayIds[0], {
      ...body,
      [field]: value,
    }).expect(400);
    expect(invalid.body.code).toBe(ErrorCode.ValidationFailed);
    expect(invalid.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
    const created = (await addBudget(dayIds[0], body).expect(201)).body;
    const patched = await patchBudget(created._id, { [field]: value }).expect(
      400,
    );
    expect(patched.body.code).toBe(ErrorCode.ValidationFailed);
    expect((await getTrip()).days[0].budgetEntries).toEqual([created]);
  });

  it('rejects unknown properties, malformed IDs and days outside the itinerary', async () => {
    const created = (await addBudget(dayIds[0], body).expect(201)).body;
    const otherTrip = await t
      .http()
      .post('/api/itineraries')
      .set('Cookie', cookie)
      .send({ title: 'Other', countryCodes: ['EG'], startDate: '2027-04-01' })
      .expect(201);
    const otherDay = await t
      .http()
      .post(`/api/itineraries/${otherTrip.body._id}/days`)
      .set('Cookie', cookie)
      .send({ cityId: 'cairo' })
      .expect(201);
    const missing = 'ffffffffffffffffffffffff';
    const responses = [
      await addBudget(dayIds[0], { ...body, ownerId: userId }),
      await patchBudget(created._id, { _id: created._id }),
      await addBudget('bad-id', body),
      await addBudget(missing, body),
      await addBudget(otherDay.body._id, body),
      await patchBudget('bad-id', { amountMinor: 0 }),
      await deleteBudget('bad-id'),
      await patchBudget(missing, { amountMinor: 0 }),
      await deleteBudget(missing),
      await t
        .http()
        .get('/api/itineraries/bad-id/budget-summary')
        .set('Cookie', cookie),
      await t
        .http()
        .get(`/api/itineraries/${missing}/budget-summary`)
        .set('Cookie', cookie),
    ];
    // Malformed IDs and unknown body fields are 400; well-formed IDs that
    // do not resolve to an owned resource are 404.
    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(
        [5, 6, 9].includes(index) ? 400 : index < 5 ? 400 : 404,
      );
    }
    expect((await getTrip()).days[0].budgetEntries).toEqual([created]);
  });

  it("requires authentication and hides another owner's budgets with 404", async () => {
    const created = (await addBudget(dayIds[0], body).expect(201)).body;
    const other = await loginAs(t.connection, UserRole.USER);
    for (const [session, status, code] of [
      ['', 401, ErrorCode.NotAuthenticated],
      [other.cookie, 404, ErrorCode.NotFound],
    ] as const) {
      const responses = [
        await addBudget(dayIds[0], body, session),
        await patchBudget(created._id, { amountMinor: 0 }, session),
        await deleteBudget(created._id, session),
        await summary(session),
      ];
      for (const response of responses) {
        expect(response.status).toBe(status);
        expect(response.body.code).toBe(code);
      }
    }
    expect((await getTrip()).days[0].budgetEntries).toEqual([created]);
  });

  it('converts every amount to the preferred currency and reports the rate date', async () => {
    await seedSummaryData();
    const response = await summary().expect(200);
    expect(response.body).toEqual({
      displayCurrency: 'EGP',
      rateDate: '2026-11-01',
      total: { amountMinor: 42600, currency: 'EGP' },
      byCategory: {
        food: { amountMinor: 5100, currency: 'EGP' },
        accommodation: { amountMinor: 1000, currency: 'EGP' },
        in_city_transport: { amountMinor: 500, currency: 'EGP' },
        activities: { amountMinor: 1000, currency: 'EGP' },
        intercity_transport: { amountMinor: 35000, currency: 'EGP' },
      },
      byDay: [
        {
          dayId: dayIds[0],
          dayNumber: 1,
          date: '2027-04-01',
          cityId: 'cairo',
          total: { amountMinor: 32100, currency: 'EGP' },
          byCategory: {
            food: { amountMinor: 100, currency: 'EGP' },
            accommodation: { amountMinor: 1000, currency: 'EGP' },
            in_city_transport: { amountMinor: 0, currency: 'EGP' },
            activities: { amountMinor: 1000, currency: 'EGP' },
            intercity_transport: { amountMinor: 30000, currency: 'EGP' },
          },
        },
        {
          dayId: dayIds[1],
          dayNumber: 2,
          date: '2027-04-02',
          cityId: 'cairo',
          total: { amountMinor: 500, currency: 'EGP' },
          byCategory: {
            food: { amountMinor: 0, currency: 'EGP' },
            accommodation: { amountMinor: 0, currency: 'EGP' },
            in_city_transport: { amountMinor: 500, currency: 'EGP' },
            activities: { amountMinor: 0, currency: 'EGP' },
            intercity_transport: { amountMinor: 0, currency: 'EGP' },
          },
        },
        {
          dayId: dayIds[2],
          dayNumber: 3,
          date: '2027-04-03',
          cityId: 'dubai',
          total: { amountMinor: 10000, currency: 'EGP' },
          byCategory: {
            food: { amountMinor: 5000, currency: 'EGP' },
            accommodation: { amountMinor: 0, currency: 'EGP' },
            in_city_transport: { amountMinor: 0, currency: 'EGP' },
            activities: { amountMinor: 0, currency: 'EGP' },
            intercity_transport: { amountMinor: 5000, currency: 'EGP' },
          },
        },
      ],
      byCityGroup: [
        {
          cityId: 'cairo',
          fromDay: 1,
          toDay: 2,
          dayCount: 2,
          checkIn: '2027-04-01',
          checkOut: '2027-04-03',
          total: { amountMinor: 32600, currency: 'EGP' },
        },
        {
          cityId: 'dubai',
          fromDay: 3,
          toDay: 3,
          dayCount: 1,
          checkIn: '2027-04-03',
          checkOut: '2027-04-04',
          total: { amountMinor: 10000, currency: 'EGP' },
        },
      ],
    });
  });

  it('uses the current preferred currency when the profile changes', async () => {
    await seedSummaryData();
    const users = t.moduleRef.get<Model<User>>(getModelToken(User.name));
    await users.findByIdAndUpdate(userId, { preferredCurrency: 'USD' });
    const response = await summary().expect(200);
    expect(response.body.displayCurrency).toBe('USD');
    expect(response.body.total).toEqual({ amountMinor: 852, currency: 'USD' });
    const food = response.body.byCategory.food;
    expect(food).toEqual({ amountMinor: 102, currency: 'USD' });
    const firstDay = response.body.byDay[0];
    expect(firstDay.byCategory.accommodation).toEqual({
      amountMinor: 20,
      currency: 'USD',
    });
  });

  it('sums to a zero, complete summary for an itinerary without amounts', async () => {
    const response = await summary().expect(200);
    expect(response.body).toEqual({
      displayCurrency: 'EGP',
      rateDate: '2026-11-01',
      total: { amountMinor: 0, currency: 'EGP' },
      byCategory: {
        food: { amountMinor: 0, currency: 'EGP' },
        accommodation: { amountMinor: 0, currency: 'EGP' },
        in_city_transport: { amountMinor: 0, currency: 'EGP' },
        activities: { amountMinor: 0, currency: 'EGP' },
        intercity_transport: { amountMinor: 0, currency: 'EGP' },
      },
      byDay: [
        expect.objectContaining({
          dayNumber: 1,
          total: { amountMinor: 0, currency: 'EGP' },
        }),
        expect.objectContaining({
          dayNumber: 2,
          total: { amountMinor: 0, currency: 'EGP' },
        }),
        expect.objectContaining({
          dayNumber: 3,
          total: { amountMinor: 0, currency: 'EGP' },
        }),
      ],
      byCityGroup: [
        expect.objectContaining({ cityId: 'cairo', dayCount: 2 }),
        expect.objectContaining({ cityId: 'dubai', dayCount: 1 }),
      ],
    });
  });

  it('reflects edits and deletions in the summary', async () => {
    const created = (await addBudget(dayIds[0], body).expect(201)).body;
    expect((await summary().expect(200)).body.total).toEqual({
      amountMinor: 1500,
      currency: 'EGP',
    });
    await patchBudget(created._id, { amountMinor: 500 }).expect(200);
    expect((await summary().expect(200)).body.total).toEqual({
      amountMinor: 500,
      currency: 'EGP',
    });
    await deleteBudget(created._id).expect(204);
    expect((await summary().expect(200)).body.total).toEqual({
      amountMinor: 0,
      currency: 'EGP',
    });
  });

  it('answers 503 RATES_UNAVAILABLE when there are no exchange rates', async () => {
    await seedSummaryData();
    fx.setNoRates();
    try {
      const response = await summary().expect(503);
      expect(response.body.code).toBe(ErrorCode.RatesUnavailable);
    } finally {
      // Reset for the other tests: the fake is shared by the whole suite.
      Object.assign(
        fx,
        new FakeFxService({
          rates: { USD: 1, EGP: 50, EUR: 5, JPY: 100 },
          minorUnits: { JPY: 0 },
          rateDate: '2026-11-01',
        }),
      );
    }
  });

  it('documents all four routes with ITN-14 summaries and typed responses', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );
    for (const [path, method, status] of [
      ['/api/itineraries/{id}/days/{dayId}/budgets', 'post', '201'],
      ['/api/budgets/{id}', 'patch', '200'],
      ['/api/budgets/{id}', 'delete', '204'],
      ['/api/itineraries/{id}/budget-summary', 'get', '200'],
    ] as const) {
      const operation = document.paths[path]?.[method];
      expect(operation?.summary).toContain('ITN-14');
      expect(operation?.tags).toContain('itineraries');
      expect(operation?.security).toEqual([{ cookie: [] }]);
      expect(operation?.responses).toHaveProperty(status);
      expect(operation?.responses).toHaveProperty('400');
      expect(operation?.responses).toHaveProperty('401');
      expect(operation?.responses).toHaveProperty('404');
    }
    expect(document.components?.schemas?.CreateBudgetEntryDto).toMatchObject({
      required: ['category', 'amountMinor', 'currency'],
    });
    expect(
      document.paths['/api/itineraries/{id}/budget-summary']?.get?.responses[
        '200'
      ],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/BudgetSummaryResponseDto' },
        },
      },
    });
  });
});
