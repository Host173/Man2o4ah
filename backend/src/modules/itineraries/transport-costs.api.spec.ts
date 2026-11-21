import { MAX_AMOUNT_MINOR } from '../../common/money/money.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { ItinerariesModule } from './itineraries.module.js';
import type { CreateTransportCostDto } from './dto/create-transport-cost.dto.js';
import type { TransportCostView } from './itineraries.types.js';
import { TransportMode } from './schemas/itinerary.schema.js';

describe('Transport costs HTTP API (ITN-16)', () => {
  let t: TestApp;
  let cookie: string;
  let itineraryId: string;
  let dayIds: string[];
  let body: CreateTransportCostDto;
  const referenceData = new FakeReferenceDataService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [ItinerariesModule],
      override: (builder) =>
        builder.overrideProvider(ReferenceDataService).useValue(referenceData),
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    cookie = (await loginAs(t.connection, UserRole.USER)).cookie;
    const itinerary = await t
      .http()
      .post('/api/itineraries')
      .set('Cookie', cookie)
      .send({
        title: 'Transport trip',
        countryCodes: ['EG'],
        startDate: '2027-04-01',
      })
      .expect(201);
    itineraryId = itinerary.body._id;
    dayIds = [];
    for (const cityId of ['cairo', 'dubai']) {
      const day = await t
        .http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', cookie)
        .send({ cityId })
        .expect(201);
      dayIds.push(day.body._id);
    }
    body = {
      dayId: dayIds[0],
      mode: TransportMode.TRAIN,
      fromCityId: 'cairo',
      toCityId: 'dubai',
      amountMinor: 12550,
      currency: 'EGP',
    };
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  function add(input: object = body, session = cookie) {
    return t
      .http()
      .post(`/api/itineraries/${itineraryId}/transport-costs`)
      .set('Cookie', session)
      .send(input);
  }

  async function createCost(): Promise<TransportCostView> {
    return (await add().expect(201)).body;
  }

  async function getTrip() {
    return (
      await t
        .http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', cookie)
        .expect(200)
    ).body;
  }

  it('adds, edits all six fields, and deletes only the selected entry', async () => {
    const first = await createCost();
    const second = await createCost();
    expect(first).toEqual({
      _id: expect.stringMatching(/^[0-9a-f]{24}$/),
      ...body,
    });
    const changes = {
      dayId: dayIds[1],
      mode: TransportMode.FERRY,
      fromCityId: 'dubai',
      toCityId: 'new_york',
      amountMinor: 0,
      currency: 'JPY',
    };
    const updated = await t
      .http()
      .patch(`/api/transport-costs/${first._id}`)
      .set('Cookie', cookie)
      .send(changes)
      .expect(200);
    expect(updated.body).toEqual({ _id: first._id, ...changes });
    expect((await getTrip()).transportCosts).toEqual([updated.body, second]);
    await t
      .http()
      .delete(`/api/transport-costs/${first._id}`)
      .set('Cookie', cookie)
      .expect(204);
    expect((await getTrip()).transportCosts).toEqual([second]);
    const missing = await t
      .http()
      .delete(`/api/transport-costs/${first._id}`)
      .set('Cookie', cookie)
      .expect(404);
    expect(missing.body.code).toBe(ErrorCode.NotFound);
  });

  it('supports partial updates and an empty patch without changing other fields or timestamps', async () => {
    const cost = await createCost();
    const updated = await t
      .http()
      .patch(`/api/transport-costs/${cost._id}`)
      .set('Cookie', cookie)
      .send({ amountMinor: 0 })
      .expect(200);
    expect(updated.body).toEqual({ ...cost, amountMinor: 0 });
    const before = await getTrip();
    const unchanged = await t
      .http()
      .patch(`/api/transport-costs/${cost._id}`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    expect(unchanged.body).toEqual(updated.body);
    expect((await getTrip()).updatedAt).toBe(before.updatedAt);
  });

  it.each(Object.values(TransportMode))(
    'accepts %s mode and zero cost',
    async (mode) => {
      const response = await add({ ...body, mode, amountMinor: 0 }).expect(201);
      expect(response.body).toEqual({
        _id: expect.any(String),
        ...body,
        mode,
        amountMinor: 0,
      });
    },
  );

  it('preserves the largest allowed amount and rejects one more', async () => {
    const response = await add({
      ...body,
      amountMinor: MAX_AMOUNT_MINOR,
    }).expect(201);
    expect(response.body.amountMinor).toBe(MAX_AMOUNT_MINOR);
    expect((await getTrip()).transportCosts[0].amountMinor).toBe(
      MAX_AMOUNT_MINOR,
    );
    await add({ ...body, amountMinor: MAX_AMOUNT_MINOR + 1 }).expect(400);
  });

  it.each([
    'dayId',
    'mode',
    'fromCityId',
    'toCityId',
    'amountMinor',
    'currency',
  ] as const)(
    'requires %s on creation and rejects null on creation and editing',
    async (field) => {
      const incomplete: Partial<CreateTransportCostDto> = { ...body };
      delete incomplete[field];
      for (const input of [incomplete, { ...body, [field]: null }]) {
        const response = await add(input).expect(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
        expect(response.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
      const cost = await createCost();
      const response = await t
        .http()
        .patch(`/api/transport-costs/${cost._id}`)
        .set('Cookie', cookie)
        .send({ [field]: null })
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      expect((await getTrip()).transportCosts).toEqual([cost]);
    },
  );

  it.each([
    ['mode', 'taxi'],
    ['dayId', 'bad-id'],
    ['fromCityId', 'missing-city'],
    ['toCityId', 'missing-city'],
    ['fromCityId', ' '],
    ['currency', 'XXX'],
    ['amountMinor', -1],
    ['amountMinor', 1.5],
    ['amountMinor', '12550'],
    ['amountMinor', Number.MAX_SAFE_INTEGER + 1],
  ])(
    'rejects invalid %s = %s on create and update without mutation',
    async (field, value) => {
      const code =
        field === 'currency'
          ? ErrorCode.UnsupportedCurrency
          : ErrorCode.ValidationFailed;
      const invalid = await add({ ...body, [field]: value }).expect(400);
      expect(invalid.body.code).toBe(code);
      expect(invalid.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
      const cost = await createCost();
      const patched = await t
        .http()
        .patch(`/api/transport-costs/${cost._id}`)
        .set('Cookie', cookie)
        .send({ [field]: value })
        .expect(400);
      expect(patched.body.code).toBe(code);
      expect((await getTrip()).transportCosts).toEqual([cost]);
    },
  );

  it('rejects unknown request properties and malformed route IDs', async () => {
    const cost = await createCost();
    const responses = [
      await add({ ...body, ownerId: new Types.ObjectId().toHexString() }),
      await t
        .http()
        .patch(`/api/transport-costs/${cost._id}`)
        .set('Cookie', cookie)
        .send({ _id: cost._id }),
      await t
        .http()
        .post('/api/itineraries/bad-id/transport-costs')
        .set('Cookie', cookie)
        .send(body),
      await t
        .http()
        .patch('/api/transport-costs/bad-id')
        .set('Cookie', cookie)
        .send({}),
      await t
        .http()
        .delete('/api/transport-costs/bad-id')
        .set('Cookie', cookie),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    }
    expect((await getTrip()).transportCosts).toEqual([cost]);
  });

  it('returns 404 for absent entries and days outside the parent itinerary', async () => {
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
    const cost = await createCost();
    const missingId = new Types.ObjectId().toHexString();
    for (const dayId of [otherDay.body._id, missingId]) {
      const created = await add({ ...body, dayId }).expect(404);
      const updated = await t
        .http()
        .patch(`/api/transport-costs/${cost._id}`)
        .set('Cookie', cookie)
        .send({ dayId })
        .expect(404);
      expect(created.body.code).toBe(ErrorCode.NotFound);
      expect(updated.body.code).toBe(ErrorCode.NotFound);
    }
    const responses = [
      await t
        .http()
        .post(`/api/itineraries/${missingId}/transport-costs`)
        .set('Cookie', cookie)
        .send(body),
      await t
        .http()
        .patch(`/api/transport-costs/${missingId}`)
        .set('Cookie', cookie)
        .send({}),
      await t
        .http()
        .delete(`/api/transport-costs/${missingId}`)
        .set('Cookie', cookie),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCode.NotFound);
    }
    expect((await getTrip()).transportCosts).toEqual([cost]);
  });

  it("requires authentication and hides another traveler's resources with 404", async () => {
    const cost = await createCost();
    const other = await loginAs(t.connection, UserRole.USER);
    for (const [session, status, code] of [
      ['', 401, ErrorCode.NotAuthenticated],
      [other.cookie, 404, ErrorCode.NotFound],
    ] as const) {
      const responses = [
        await add(body, session),
        await t
          .http()
          .patch(`/api/transport-costs/${cost._id}`)
          .set('Cookie', session)
          .send({ amountMinor: 0 }),
        await t
          .http()
          .delete(`/api/transport-costs/${cost._id}`)
          .set('Cookie', session),
      ];
      for (const response of responses) {
        expect(response.status).toBe(status);
        expect(response.body.code).toBe(code);
      }
    }
    expect((await getTrip()).transportCosts).toEqual([cost]);
  });

  it.each([
    UserRole.ADMIN,
    UserRole.AIRLINE_MODERATOR,
    UserRole.HOTEL_MODERATOR,
  ])(
    'allows an owning %s account and hides other owners with 404',
    async (role) => {
      const cost = await createCost();
      const other = await loginAs(t.connection, role);
      const responses = [
        await add(body, other.cookie),
        await t
          .http()
          .patch(`/api/transport-costs/${cost._id}`)
          .set('Cookie', other.cookie)
          .send({ amountMinor: 0 }),
        await t
          .http()
          .delete(`/api/transport-costs/${cost._id}`)
          .set('Cookie', other.cookie),
      ];
      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(response.body.code).toBe(ErrorCode.NotFound);
      }
      expect((await getTrip()).transportCosts).toEqual([cost]);

      const ownedTrip = await t
        .http()
        .post('/api/itineraries')
        .set('Cookie', other.cookie)
        .send({ title: 'Owned', countryCodes: ['EG'], startDate: '2027-04-01' })
        .expect(201);
      const day = await t
        .http()
        .post(`/api/itineraries/${ownedTrip.body._id}/days`)
        .set('Cookie', other.cookie)
        .send({ cityId: 'cairo' })
        .expect(201);
      const created = await t
        .http()
        .post(`/api/itineraries/${ownedTrip.body._id}/transport-costs`)
        .set('Cookie', other.cookie)
        .send({ ...body, dayId: day.body._id })
        .expect(201);
      const edited = await t
        .http()
        .patch(`/api/transport-costs/${created.body._id}`)
        .set('Cookie', other.cookie)
        .send({ amountMinor: 0 })
        .expect(200);
      expect(edited.body).toEqual({ ...created.body, amountMinor: 0 });
      await t
        .http()
        .delete(`/api/transport-costs/${created.body._id}`)
        .set('Cookie', other.cookie)
        .expect(204);
    },
  );

  it('preserves concurrent additions and disjoint edits', async () => {
    const added = await Promise.allSettled(
      Array.from({ length: 4 }, () => add().expect(201)),
    );
    expect(added.every((result) => result.status === 'fulfilled')).toBe(true);
    const trip = await getTrip();
    expect(trip.transportCosts).toHaveLength(4);
    expect(
      new Set(trip.transportCosts.map((cost: TransportCostView) => cost._id))
        .size,
    ).toBe(4);
    const costId = trip.transportCosts[0]._id;
    const edits = await Promise.allSettled([
      t
        .http()
        .patch(`/api/transport-costs/${costId}`)
        .set('Cookie', cookie)
        .send({ amountMinor: 0 })
        .expect(200),
      t
        .http()
        .patch(`/api/transport-costs/${costId}`)
        .set('Cookie', cookie)
        .send({ currency: 'JPY' })
        .expect(200),
    ]);
    expect(edits.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await getTrip()).transportCosts[0]).toMatchObject({
      amountMinor: 0,
      currency: 'JPY',
    });
  });

  it.each(['add', 'move'] as const)(
    'rejects %s when its destination day disappears during validation',
    async (operation) => {
      const cost = await createCost();
      const getCurrency = referenceData.getCurrency.bind(referenceData);
      vi.spyOn(referenceData, 'getCurrency').mockImplementationOnce(
        async (currency) => {
          await t
            .http()
            .delete(`/api/itineraries/${itineraryId}/days/${dayIds[1]}`)
            .set('Cookie', cookie)
            .expect(204);
          return getCurrency(currency);
        },
      );
      const response =
        operation === 'add'
          ? await add({ ...body, dayId: dayIds[1] })
          : await t
              .http()
              .patch(`/api/transport-costs/${cost._id}`)
              .set('Cookie', cookie)
              .send({ dayId: dayIds[1], currency: 'JPY' });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCode.NotFound);
      expect((await getTrip()).transportCosts).toEqual([cost]);
    },
  );

  it('cascades a created transport cost when its day is deleted', async () => {
    await createCost();
    const kept = (await add({ ...body, dayId: dayIds[1] }).expect(201)).body;
    await t
      .http()
      .delete(`/api/itineraries/${itineraryId}/days/${dayIds[0]}`)
      .set('Cookie', cookie)
      .expect(204);
    const trip = await getTrip();
    expect(trip.transportCosts).toEqual([kept]);
    expect(trip.days.map((day: { _id: string }) => day._id)).toEqual([
      dayIds[1],
    ]);
  });

  it('documents typed requests, responses, auth and all three operations in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );
    for (const [path, method, status] of [
      ['/api/itineraries/{id}/transport-costs', 'post', '201'],
      ['/api/transport-costs/{id}', 'patch', '200'],
      ['/api/transport-costs/{id}', 'delete', '204'],
    ] as const) {
      const operation = document.paths[path]?.[method];
      expect(operation?.summary).toContain('ITN-16');
      expect(operation?.tags).toContain('itineraries');
      expect(operation?.security).toEqual([{ cookie: [] }]);
      expect(operation?.responses).toHaveProperty(status);
      expect(operation?.responses).toHaveProperty('400');
      expect(operation?.responses).toHaveProperty('401');
      expect(operation?.responses).toHaveProperty('404');
    }
    expect(
      document.paths['/api/itineraries/{id}/transport-costs']?.post?.responses[
        '201'
      ],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TransportCostResponseDto' },
        },
      },
    });
    expect(
      document.paths['/api/transport-costs/{id}']?.patch?.responses['200'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TransportCostResponseDto' },
        },
      },
    });
    expect(document.components?.schemas?.CreateTransportCostDto).toMatchObject({
      required: [
        'dayId',
        'mode',
        'fromCityId',
        'toCityId',
        'amountMinor',
        'currency',
      ],
    });
  });
});
