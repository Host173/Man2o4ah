import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../src/common/dates/date-only.js';
import {
  Itinerary,
  ItinerarySchema,
} from '../../src/modules/itineraries/schemas/itinerary.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

function activityDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Pyramids of Giza',
    description: 'Guided tour',
    time: '09:30',
    cost: { amountMinor: 2_000, currency: 'EGP' },
    attractionId: 'att-1',
    ...overrides,
  };
}

function budgetEntryDoc(overrides: Record<string, unknown> = {}) {
  return {
    category: 'food',
    amountMinor: 1_500,
    currency: 'EGP',
    note: 'Lunch',
    ...overrides,
  };
}

function dayDoc(overrides: Record<string, unknown> = {}) {
  return {
    cityId: 'cairo',
    notes: 'Arrival day',
    activities: [activityDoc()],
    budgetEntries: [budgetEntryDoc()],
    ...overrides,
  };
}

function transportCostDoc(
  dayId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return {
    dayId,
    mode: 'train',
    fromCityId: 'cairo',
    toCityId: 'luxor',
    amountMinor: 30_000,
    currency: 'EGP',
    ...overrides,
  };
}

function itineraryDoc(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: new Types.ObjectId(),
    title: 'Egypt in a week',
    countryCodes: ['EG'],
    startDate: toDateOnly('2027-04-01'),
    days: [dayDoc()],
    dayCount: 1,
    cityIds: ['cairo'],
    ...overrides,
  };
}

/** n days, with dayCount and cityIds matching. */
function withDays(n: number) {
  return {
    days: Array.from({ length: n }, () => dayDoc()),
    dayCount: n,
    cityIds: n > 0 ? ['cairo'] : [],
  };
}

function images(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `img-${i}.jpg` }));
}

describe('itineraries schemas', () => {
  let db: TestDatabase;
  let itineraries: Model<Itinerary>;

  beforeAll(async () => {
    db = await startTestDatabase('itineraries');
    itineraries = db.connection.model(Itinerary.name, ItinerarySchema);
    await itineraries.init();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await itineraries.deleteMany({});
  });

  it('uses the itineraries collection', () => {
    expect(itineraries.collection.collectionName).toBe('itineraries');
  });

  it('saves a valid itinerary with its defaults', async () => {
    const itinerary = await itineraries.create(
      itineraryDoc({ days: undefined, dayCount: 0, cityIds: [] }),
    );
    expect(itinerary.visibility).toBe('private');
    expect(itinerary.isHidden).toBe(false);
    expect(itinerary.authorDeactivated).toBe(false);
    expect(itinerary.days).toEqual([]);
    expect(itinerary.transportCosts).toEqual([]);
    expect(itinerary.clonedFrom).toBeUndefined();
    expect(itinerary.createdAt).toBeInstanceOf(Date);
    expect(itinerary.updatedAt).toBeInstanceOf(Date);
  });

  it('gives days, activities, budget entries, transport costs and images their own _id', async () => {
    const created = await itineraries.create(
      itineraryDoc({
        days: [dayDoc({ activities: [activityDoc({ images: images(1) })] })],
      }),
    );
    const day = created.days[0] as unknown as { _id: Types.ObjectId };
    await itineraries.updateOne(
      { _id: created._id },
      { $push: { transportCosts: transportCostDoc(day._id) } },
    );
    const itinerary = (await itineraries.findById(created._id).lean())!;
    const [savedDay] = itinerary.days as unknown as {
      _id: Types.ObjectId;
      activities: {
        _id: Types.ObjectId;
        cost: object;
        images: { _id: Types.ObjectId }[];
      }[];
      budgetEntries: { _id: Types.ObjectId }[];
    }[];
    expect(savedDay._id).toBeInstanceOf(Types.ObjectId);
    expect(savedDay.activities[0]._id).toBeInstanceOf(Types.ObjectId);
    expect(savedDay.activities[0].images[0]._id).toBeInstanceOf(Types.ObjectId);
    expect(savedDay.budgetEntries[0]._id).toBeInstanceOf(Types.ObjectId);
    expect(savedDay.activities[0].cost).not.toHaveProperty('_id');
    const [cost] = itinerary.transportCosts as unknown as {
      _id: Types.ObjectId;
      dayId: Types.ObjectId;
    }[];
    expect(cost._id).toBeInstanceOf(Types.ObjectId);
    expect(cost.dayId).toBeInstanceOf(Types.ObjectId);
    expect(cost.dayId.equals(savedDay._id)).toBe(true);
  });

  it('stores ownerId as an ObjectId and rejects an invalid one', async () => {
    await expect(
      new itineraries(itineraryDoc({ ownerId: 'abc' })).validate(),
    ).rejects.toThrow(/ownerId/);
    const ownerId = new Types.ObjectId();
    const itinerary = await itineraries.create(
      itineraryDoc({ ownerId: ownerId.toHexString() }),
    );
    const saved = await itineraries.collection.findOne({ _id: itinerary._id });
    expect(saved!.ownerId).toBeInstanceOf(Types.ObjectId);
    expect((saved!.ownerId as Types.ObjectId).equals(ownerId)).toBe(true);
  });

  it('accepts at most 60 days', async () => {
    await expect(
      new itineraries(itineraryDoc(withDays(61))).validate(),
    ).rejects.toThrow(/days must have at most 60 items/);
    await expect(
      new itineraries(itineraryDoc(withDays(60))).validate(),
    ).resolves.toBeUndefined();
  });

  it('trims the title and accepts 1-100 characters', async () => {
    for (const title of ['x'.repeat(101), '   ', undefined]) {
      await expect(
        new itineraries(itineraryDoc({ title })).validate(),
      ).rejects.toThrow(/title/);
    }
    const itinerary = new itineraries(
      itineraryDoc({ title: `  ${'x'.repeat(100)}  ` }),
    );
    await expect(itinerary.validate()).resolves.toBeUndefined();
    expect(itinerary.title).toBe('x'.repeat(100));
  });

  it('requires at least one country code', async () => {
    for (const countryCodes of [[], undefined]) {
      await expect(
        new itineraries(itineraryDoc({ countryCodes })).validate(),
      ).rejects.toThrow(/countryCodes must have at least 1 item/);
    }
    await expect(
      new itineraries(itineraryDoc({ countryCodes: ['EG'] })).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects duplicate country codes', async () => {
    await expect(
      new itineraries(itineraryDoc({ countryCodes: ['EG', 'EG'] })).validate(),
    ).rejects.toThrow(/countryCodes must not contain duplicates/);
    await expect(
      new itineraries(itineraryDoc({ countryCodes: ['EG', 'JO'] })).validate(),
    ).resolves.toBeUndefined();
  });

  it('requires startDate as a DateOnly', async () => {
    for (const startDate of [undefined, new Date('2027-04-01T10:00:00.000Z')]) {
      await expect(
        new itineraries(itineraryDoc({ startDate })).validate(),
      ).rejects.toThrow(/startDate/);
    }
  });

  it('accepts only the visibility values', async () => {
    await expect(
      new itineraries(itineraryDoc({ visibility: 'friends' })).validate(),
    ).rejects.toThrow(/visibility/);
    await expect(
      new itineraries(itineraryDoc({ visibility: 'public' })).validate(),
    ).resolves.toBeUndefined();
  });

  it('requires both ids in clonedFrom when present', async () => {
    for (const clonedFrom of [
      { itineraryId: new Types.ObjectId() },
      { authorId: new Types.ObjectId() },
      { itineraryId: 'abc', authorId: new Types.ObjectId() },
    ]) {
      await expect(
        new itineraries(itineraryDoc({ clonedFrom })).validate(),
      ).rejects.toThrow(/clonedFrom\./);
    }
    const itinerary = await itineraries.create(
      itineraryDoc({
        clonedFrom: {
          itineraryId: new Types.ObjectId(),
          authorId: new Types.ObjectId(),
        },
      }),
    );
    expect(itinerary.toObject().clonedFrom).not.toHaveProperty('_id');
  });

  it('requires the derived dayCount and cityIds', async () => {
    for (const overrides of [
      { dayCount: undefined },
      { dayCount: -1 },
      { dayCount: 1.5 },
    ]) {
      await expect(
        new itineraries(itineraryDoc(overrides)).validate(),
      ).rejects.toThrow(/dayCount/);
    }
    await expect(
      new itineraries(itineraryDoc(withDays(0))).validate(),
    ).resolves.toBeUndefined();
  });

  describe('days', () => {
    it('requires the city and limits notes to 2000 characters', async () => {
      for (const day of [
        dayDoc({ cityId: undefined }),
        dayDoc({ notes: 'x'.repeat(2001) }),
      ]) {
        await expect(
          new itineraries(itineraryDoc({ days: [day] })).validate(),
        ).rejects.toThrow(/days\.0\./);
      }
      await expect(
        new itineraries(
          itineraryDoc({ days: [dayDoc({ notes: 'x'.repeat(2000) })] }),
        ).validate(),
      ).resolves.toBeUndefined();
    });
  });

  describe('activities', () => {
    function withActivity(overrides: Record<string, unknown>) {
      return itineraryDoc({
        days: [dayDoc({ activities: [activityDoc(overrides)] })],
      });
    }

    it('rejects a time of 25:00', async () => {
      for (const time of ['25:00', '9:30']) {
        await expect(
          new itineraries(withActivity({ time })).validate(),
        ).rejects.toThrow(/days\.0\.activities\.0\.time/);
      }
      for (const time of ['23:59', undefined]) {
        await expect(
          new itineraries(withActivity({ time })).validate(),
        ).resolves.toBeUndefined();
      }
    });

    it('accepts at most 5 images', async () => {
      await expect(
        new itineraries(withActivity({ images: images(6) })).validate(),
      ).rejects.toThrow(/images must have at most 5 items/);
      await expect(
        new itineraries(withActivity({ images: images(5) })).validate(),
      ).resolves.toBeUndefined();
    });

    it('validates name, description and cost', async () => {
      const invalid = [
        { name: undefined },
        { name: 'x'.repeat(101) },
        { description: 'x'.repeat(1001) },
        { cost: { amountMinor: -1, currency: 'EGP' } },
        { cost: { amountMinor: 1.5, currency: 'EGP' } },
        { cost: { amountMinor: 100 } },
      ];
      for (const overrides of invalid) {
        await expect(
          new itineraries(withActivity(overrides)).validate(),
        ).rejects.toThrow(
          new RegExp(
            `days\\.0\\.activities\\.0\\.${Object.keys(overrides)[0]}`,
          ),
        );
      }
      await expect(
        new itineraries(
          withActivity({
            name: 'x'.repeat(100),
            description: 'x'.repeat(1000),
            cost: undefined,
            attractionId: undefined,
          }),
        ).validate(),
      ).resolves.toBeUndefined();
      await expect(
        new itineraries(
          withActivity({ cost: { amountMinor: 0, currency: 'JPY' } }),
        ).validate(),
      ).resolves.toBeUndefined();
    });
  });

  describe('budget entries', () => {
    function withEntry(overrides: Record<string, unknown>) {
      return itineraryDoc({
        days: [dayDoc({ budgetEntries: [budgetEntryDoc(overrides)] })],
      });
    }

    it('rejects a negative amount', async () => {
      for (const amountMinor of [-1, 1.5]) {
        await expect(
          new itineraries(withEntry({ amountMinor })).validate(),
        ).rejects.toThrow(/days\.0\.budgetEntries\.0\.amountMinor/);
      }
      await expect(
        new itineraries(withEntry({ amountMinor: 0 })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects an unknown category', async () => {
      for (const category of ['intercity_transport', 'shopping', undefined]) {
        await expect(
          new itineraries(withEntry({ category })).validate(),
        ).rejects.toThrow(/days\.0\.budgetEntries\.0\.category/);
      }
      for (const category of [
        'food',
        'accommodation',
        'in_city_transport',
        'activities',
      ]) {
        await expect(
          new itineraries(withEntry({ category })).validate(),
        ).resolves.toBeUndefined();
      }
    });

    it('limits the note to 200 characters', async () => {
      await expect(
        new itineraries(withEntry({ note: 'x'.repeat(201) })).validate(),
      ).rejects.toThrow(/days\.0\.budgetEntries\.0\.note/);
      await expect(
        new itineraries(withEntry({ note: 'x'.repeat(200) })).validate(),
      ).resolves.toBeUndefined();
    });
  });

  describe('transport costs', () => {
    it("rejects a dayId that matches none of the itinerary's days", async () => {
      const dayId = new Types.ObjectId();
      const days = [dayDoc({ _id: dayId }), dayDoc({ cityId: 'luxor' })];
      await expect(
        new itineraries(
          itineraryDoc({
            days,
            dayCount: 2,
            cityIds: ['cairo', 'luxor'],
            transportCosts: [transportCostDoc(new Types.ObjectId())],
          }),
        ).validate(),
      ).rejects.toThrow(/every transportCosts dayId must be the _id of a day/);
      await expect(
        new itineraries(
          itineraryDoc({
            days,
            dayCount: 2,
            cityIds: ['cairo', 'luxor'],
            transportCosts: [transportCostDoc(dayId)],
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('validates mode, cities and amount', async () => {
      const dayId = new Types.ObjectId();
      const invalid = [
        { mode: 'bike' },
        { fromCityId: undefined },
        { toCityId: undefined },
        { amountMinor: -1 },
        { currency: undefined },
        { dayId: 'abc' },
      ];
      for (const overrides of invalid) {
        await expect(
          new itineraries(
            itineraryDoc({
              days: [dayDoc({ _id: dayId })],
              transportCosts: [transportCostDoc(dayId, overrides)],
            }),
          ).validate(),
        ).rejects.toThrow(
          new RegExp(`transportCosts\\.0\\.${Object.keys(overrides)[0]}`),
        );
      }
      for (const mode of ['flight', 'train', 'bus', 'car', 'ferry', 'other']) {
        await expect(
          new itineraries(
            itineraryDoc({
              days: [dayDoc({ _id: dayId })],
              transportCosts: [
                transportCostDoc(dayId, { mode, amountMinor: 0 }),
              ],
            }),
          ).validate(),
        ).resolves.toBeUndefined();
      }
    });
  });

  it('has exactly the indexes from the data model', async () => {
    const indexes = await itineraries.collection.indexes();
    expect(
      indexes.map((index) => ({
        key: index.key,
        unique: index.unique ?? false,
      })),
    ).toEqual(
      expect.arrayContaining(
        [
          { _id: 1 },
          { ownerId: 1, updatedAt: -1 },
          { visibility: 1, isHidden: 1, authorDeactivated: 1, updatedAt: -1 },
          { countryCodes: 1 },
          { cityIds: 1 },
          { 'days.activities._id': 1 },
          { 'days.budgetEntries._id': 1 },
          { 'transportCosts._id': 1 },
        ].map((key) => ({ key, unique: false })),
      ),
    );
    expect(indexes).toHaveLength(8);
  });
});
