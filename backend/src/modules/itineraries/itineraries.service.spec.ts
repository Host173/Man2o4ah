import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import type { CreateItineraryDto } from './dto/create-itinerary.dto.js';
import type { CreateDayDto } from './dto/create-day.dto.js';
import { ItinerariesModule } from './itineraries.module.js';
import { ItinerariesService } from './itineraries.service.js';
import { Itinerary, ItineraryVisibility } from './schemas/itinerary.schema.js';

function createDto(
  overrides: Partial<CreateItineraryDto> = {},
): CreateItineraryDto {
  return {
    title: '  Egypt in a week  ',
    countryCodes: ['EG'],
    startDate: '2027-04-01',
    ...overrides,
  };
}

function errorDetails(error: unknown): {
  code: string;
  details: { field: string; message: string }[];
} {
  const response = (error as BadRequestException).getResponse();
  return response as {
    code: string;
    details: { field: string; message: string }[];
  };
}

function dayDto(overrides: Partial<CreateDayDto> = {}): CreateDayDto {
  return { cityId: 'cairo', ...overrides };
}

describe('ItinerariesService (ITN-01, ITN-03)', () => {
  let t: TestApp;
  let itineraries: ItinerariesService;
  let itineraryModel: Model<Itinerary>;
  const referenceData = new FakeReferenceDataService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [ItinerariesModule],
      override: (builder) =>
        builder.overrideProvider(ReferenceDataService).useValue(referenceData),
    });
    itineraries = t.moduleRef.get(ItinerariesService);
    itineraryModel = t.moduleRef.get<Model<Itinerary>>(
      getModelToken(Itinerary.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
  });

  afterAll(async () => {
    await t.close();
  }, HOOK_TIMEOUT);

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

  describe('create', () => {
    it('creates a private itinerary owned by the user with trimmed title and DateOnly start date', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);

      const created = await itineraries.create(createDto(), owner.id);

      expect(created).toMatchObject({
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
      expect(created._id).toMatch(/^[0-9a-f]{24}$/);
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);

      const stored = await itineraryModel.findById(created._id).lean().exec();
      expect(stored?.days).toEqual([]);
      expect(stored?.startDate.toISOString()).toBe('2027-04-01T00:00:00.000Z');
    });

    it('accepts the boundary title lengths of 1 and 100 characters', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);

      const shortest = await itineraries.create(
        createDto({ title: 'x' }),
        owner.id,
      );
      expect(shortest.title).toBe('x');

      // Emoji count as one character each, not two UTF-16 code units.
      for (const title of ['x'.repeat(100), '😀'.repeat(100)]) {
        const longest = await itineraries.create(
          createDto({ title: `  ${title}  ` }),
          owner.id,
        );
        expect(longest.title).toBe(title);
      }
    });

    it('rejects blank, non-string and over-long titles with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);

      for (const title of [
        '   ',
        'x'.repeat(101),
        '😀'.repeat(101),
        undefined as never,
      ]) {
        const error = await itineraries
          .create(createDto({ title }), owner.id)
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        const body = errorDetails(error);
        expect(body.code).toBe(ErrorCode.ValidationFailed);
        expect(body.details[0].field).toBe('title');
      }
    });

    it('rejects empty or duplicate country lists and unknown countries', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);

      for (const countryCodes of [[], ['EG', 'EG'], ['ZZ']]) {
        const error = await itineraries
          .create(createDto({ countryCodes }), owner.id)
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        const body = errorDetails(error);
        expect(body.code).toBe(ErrorCode.ValidationFailed);
        expect(body.details[0].field).toBe('countryCodes');
      }

      expect(await itineraryModel.countDocuments({}).exec()).toBe(0);
    });

    it('accepts several distinct countries from the dataset', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);

      const created = await itineraries.create(
        createDto({ countryCodes: ['EG', 'AE', 'US'] }),
        owner.id,
      );
      expect(created.countryCodes).toEqual(['EG', 'AE', 'US']);
    });

    it('rejects malformed and impossible start dates', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);

      for (const startDate of ['01/04/2027', '2027-4-1', '2027-02-30']) {
        const error = await itineraries
          .create(createDto({ startDate }), owner.id)
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        const body = errorDetails(error);
        expect(body.code).toBe(ErrorCode.ValidationFailed);
        expect(body.details[0].field).toBe('startDate');
      }
    });
  });

  describe('listMine', () => {
    it('lists only the owner’s itineraries, most recently updated first', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const other = await loginAs(t.connection, UserRole.USER);

      const first = await itineraries.create(
        createDto({ title: 'First' }),
        owner.id,
      );
      const second = await itineraries.create(
        createDto({ title: 'Second' }),
        owner.id,
      );
      const third = await itineraries.create(
        createDto({ title: 'Third' }),
        owner.id,
      );
      await itineraries.create(createDto({ title: 'Other' }), other.id);

      // Make the first itinerary the most recently updated one.
      await itineraryModel.collection.updateOne(
        { _id: new Types.ObjectId(first._id) },
        { $set: { updatedAt: new Date('2030-01-01T00:00:00.000Z') } },
      );
      await itineraryModel.collection.updateOne(
        { _id: new Types.ObjectId(second._id) },
        { $set: { updatedAt: new Date('2029-01-01T00:00:00.000Z') } },
      );
      await itineraryModel.collection.updateOne(
        { _id: new Types.ObjectId(third._id) },
        { $set: { updatedAt: new Date('2028-01-01T00:00:00.000Z') } },
      );

      const page = await itineraries.listMine(owner.id);
      expect(page).toMatchObject({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
      expect(page.items.map((itinerary) => itinerary.title)).toEqual([
        'First',
        'Second',
        'Third',
      ]);
      expect(
        page.items.every((itinerary) => itinerary.ownerId === owner.id),
      ).toBe(true);
    });

    it('paginates the list with the shared list shape', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      for (const title of ['One', 'Two', 'Three']) {
        await itineraries.create(createDto({ title }), owner.id);
      }

      const page2 = await itineraries.listMine(
        owner.id,
        Object.assign(new PaginationQueryDto(), { page: 2, limit: 2 }),
      );
      expect(page2).toMatchObject({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(page2.items).toHaveLength(1);

      const empty = await itineraries.listMine(
        (await loginAs(t.connection, UserRole.USER)).id,
      );
      expect(empty).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('getById', () => {
    it('returns the full details of the owner’s itinerary', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const dayId = new Types.ObjectId();
      const activityId = new Types.ObjectId();
      const budgetId = new Types.ObjectId();
      const imageId = new Types.ObjectId();
      const costId = new Types.ObjectId();

      await itineraryModel.collection.updateOne(
        { _id: new Types.ObjectId(created._id) },
        {
          $set: {
            days: [
              {
                _id: dayId,
                cityId: 'cairo',
                notes: 'Arrival day',
                activities: [
                  {
                    _id: activityId,
                    name: 'Pyramids of Giza',
                    description: 'Guided tour',
                    time: '09:30',
                    cost: { amountMinor: 2000, currency: 'EGP' },
                    images: [{ _id: imageId, key: 'pyramids.jpg' }],
                    attractionId: 'att-1',
                  },
                ],
                budgetEntries: [
                  {
                    _id: budgetId,
                    category: 'food',
                    amountMinor: 1500,
                    currency: 'EGP',
                    note: 'Lunch',
                  },
                ],
              },
            ],
            dayCount: 1,
            cityIds: ['cairo'],
            transportCosts: [
              {
                _id: costId,
                dayId,
                mode: 'train',
                fromCityId: 'cairo',
                toCityId: 'luxor',
                amountMinor: 30000,
                currency: 'EGP',
              },
            ],
          },
        },
      );

      const detail = await itineraries.getById(created._id, owner.id);

      expect(detail).toMatchObject({
        _id: created._id,
        ownerId: owner.id,
        title: 'Egypt in a week',
        startDate: '2027-04-01',
        dayCount: 1,
        visibility: ItineraryVisibility.PRIVATE,
      });
      expect(detail.days).toEqual([
        {
          _id: dayId.toHexString(),
          dayNumber: 1,
          date: '2027-04-01',
          cityId: 'cairo',
          notes: 'Arrival day',
          activities: [
            {
              _id: activityId.toHexString(),
              name: 'Pyramids of Giza',
              description: 'Guided tour',
              time: '09:30',
              cost: { amountMinor: 2000, currency: 'EGP' },
              images: [{ _id: imageId.toHexString(), key: 'pyramids.jpg' }],
              attractionId: 'att-1',
            },
          ],
          budgetEntries: [
            {
              _id: budgetId.toHexString(),
              category: 'food',
              amountMinor: 1500,
              currency: 'EGP',
              note: 'Lunch',
            },
          ],
        },
      ]);
      expect(detail.transportCosts).toEqual([
        {
          _id: costId.toHexString(),
          dayId: dayId.toHexString(),
          mode: 'train',
          fromCityId: 'cairo',
          toCityId: 'luxor',
          amountMinor: 30000,
          currency: 'EGP',
        },
      ]);
    });

    it('derives each day’s date from the start date', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(
        createDto({ startDate: '2028-02-28' }),
        owner.id,
      );
      await itineraryModel.collection.updateOne(
        { _id: new Types.ObjectId(created._id) },
        {
          $set: {
            days: [
              { _id: new Types.ObjectId(), cityId: 'cairo' },
              { _id: new Types.ObjectId(), cityId: 'luxor' },
            ],
            dayCount: 2,
            cityIds: ['cairo', 'luxor'],
          },
        },
      );

      const detail = await itineraries.getById(created._id, owner.id);
      expect(detail.days.map((day) => day.dayNumber)).toEqual([1, 2]);
      expect(detail.days.map((day) => day.date)).toEqual([
        '2028-02-28',
        '2028-02-29',
      ]);
    });

    it('returns 404 for another user’s itinerary and for a missing one', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const intruder = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      await expect(
        itineraries.getById(created._id, intruder.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        itineraries.getById(new Types.ObjectId().toHexString(), owner.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a malformed itinerary ID with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const error = await itineraries
        .getById('not-an-id', owner.id)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(errorDetails(error).code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('update', () => {
    it('edits the title, countries and start date of the owner’s itinerary', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const oldUpdatedAt = new Date('2020-01-01T00:00:00.000Z');
      await itineraryModel.collection.updateOne(
        { _id: new Types.ObjectId(created._id) },
        { $set: { updatedAt: oldUpdatedAt } },
      );

      const updated = await itineraries.update(
        created._id,
        {
          title: '  Egypt and Jordan  ',
          countryCodes: ['EG', 'AE'],
          startDate: '2027-05-10',
        },
        owner.id,
      );

      expect(updated).toMatchObject({
        _id: created._id,
        ownerId: owner.id,
        title: 'Egypt and Jordan',
        countryCodes: ['EG', 'AE'],
        startDate: '2027-05-10',
        visibility: ItineraryVisibility.PRIVATE,
      });
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        oldUpdatedAt.getTime(),
      );
    });

    it('keeps omitted fields unchanged', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      const updated = await itineraries.update(
        created._id,
        { title: 'Renamed' },
        owner.id,
      );

      expect(updated.title).toBe('Renamed');
      expect(updated.countryCodes).toEqual(['EG']);
      expect(updated.startDate).toBe('2027-04-01');
    });

    it('returns the current itinerary for an empty body', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      const unchanged = await itineraries.update(created._id, {}, owner.id);
      expect(unchanged).toMatchObject({
        _id: created._id,
        title: 'Egypt in a week',
        countryCodes: ['EG'],
        startDate: '2027-04-01',
      });
    });

    it('validates the new values before writing', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      for (const dto of [
        { title: '   ' },
        { title: 'x'.repeat(101) },
        { countryCodes: [] },
        { countryCodes: ['EG', 'EG'] },
        { countryCodes: ['ZZ'] },
        { startDate: '2027-02-30' },
      ]) {
        const error = await itineraries
          .update(created._id, dto, owner.id)
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        expect(errorDetails(error).code).toBe(ErrorCode.ValidationFailed);
      }

      const stored = await itineraries.getById(created._id, owner.id);
      expect(stored.title).toBe('Egypt in a week');
      expect(stored.countryCodes).toEqual(['EG']);
      expect(stored.startDate).toBe('2027-04-01');
    });

    it('returns 404 for another user’s itinerary and leaves it untouched', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const intruder = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      await expect(
        itineraries.update(created._id, { title: 'Hijacked' }, intruder.id),
      ).rejects.toBeInstanceOf(NotFoundException);

      const stored = await itineraries.getById(created._id, owner.id);
      expect(stored.title).toBe('Egypt in a week');
    });
  });

  describe('delete', () => {
    it('deletes the owner’s itinerary; deleting it again is a 404', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      await itineraries.delete(created._id, owner.id);
      expect(await itineraryModel.countDocuments({}).exec()).toBe(0);

      await expect(
        itineraries.delete(created._id, owner.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 for another user’s itinerary and leaves it in place', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const intruder = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      await expect(
        itineraries.delete(created._id, intruder.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await itineraryModel.countDocuments({}).exec()).toBe(1);
    });
  });

  describe('addDay (ITN-05)', () => {
    it('appends a day with its number, date and empty details, and recomputes the derived fields', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      const first = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo', notes: '  Arrival day  ' }),
        owner.id,
      );

      expect(first).toMatchObject({
        dayNumber: 1,
        date: '2027-04-01',
        cityId: 'cairo',
        notes: '  Arrival day  ',
        activities: [],
        budgetEntries: [],
      });
      expect(first._id).toMatch(/^[0-9a-f]{24}$/);

      const second = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'dubai' }),
        owner.id,
      );
      expect(second).toMatchObject({ dayNumber: 2, date: '2027-04-02' });

      const stored = await itineraryModel.findById(created._id).lean().exec();
      expect(stored?.dayCount).toBe(2);
      expect(stored?.cityIds).toEqual(['cairo', 'dubai']);
      expect(stored?.days).toHaveLength(2);
      expect(stored?.days[0]._id.toHexString()).toBe(first._id);
    });

    it('accepts the 60th day and rejects the 61st (boundary values)', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      await seedDays(created._id, 59);

      const sixtieth = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo' }),
        owner.id,
      );
      expect(sixtieth.dayNumber).toBe(60);
      expect(sixtieth.date).toBe('2027-05-30');

      const error = await itineraries
        .addDay(created._id, dayDto({ cityId: 'cairo' }), owner.id)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(errorDetails(error).code).toBe(ErrorCode.ValidationFailed);
      expect(errorDetails(error).details[0].field).toBe('days');
      expect((await itineraries.getById(created._id, owner.id)).dayCount).toBe(
        60,
      );
    });

    it('rejects a blank, non-string or unknown city with 400 on cityId', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      for (const cityId of ['   ', 'nowhere', 42 as never]) {
        const error = await itineraries
          .addDay(created._id, dayDto({ cityId }), owner.id)
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        expect(errorDetails(error).details[0].field).toBe('cityId');
      }

      expect(await itineraryModel.countDocuments({}).exec()).toBe(1);
      expect((await itineraries.getById(created._id, owner.id)).days).toEqual(
        [],
      );
    });

    it('accepts notes of 2000 characters and rejects 2001', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      const longest = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo', notes: 'n'.repeat(2000) }),
        owner.id,
      );
      expect(longest.notes).toHaveLength(2000);

      const error = await itineraries
        .addDay(
          created._id,
          dayDto({ cityId: 'cairo', notes: 'n'.repeat(2001) }),
          owner.id,
        )
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(errorDetails(error).details[0].field).toBe('notes');
    });

    it('returns 404 for another user’s itinerary and for an unknown one', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const intruder = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      await expect(
        itineraries.addDay(
          created._id,
          dayDto({ cityId: 'cairo' }),
          intruder.id,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        itineraries.addDay(
          new Types.ObjectId().toHexString(),
          dayDto({ cityId: 'cairo' }),
          owner.id,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect((await itineraries.getById(created._id, owner.id)).days).toEqual(
        [],
      );
    });

    it('rejects malformed IDs with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);

      await expect(
        itineraries.addDay('not-an-id', dayDto({ cityId: 'cairo' }), owner.id),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.ValidationFailed },
      });
    });
  });

  describe('updateDay (ITN-05)', () => {
    it('changes the city and notes and recomputes cityIds', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const first = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo' }),
        owner.id,
      );
      await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo' }),
        owner.id,
      );

      const updated = await itineraries.updateDay(
        created._id,
        first._id,
        { cityId: 'dubai', notes: 'Moved to Dubai' },
        owner.id,
      );
      expect(updated).toMatchObject({
        _id: first._id,
        dayNumber: 1,
        date: '2027-04-01',
        cityId: 'dubai',
        notes: 'Moved to Dubai',
      });

      const stored = await itineraryModel.findById(created._id).lean().exec();
      expect(stored?.cityIds).toEqual(['cairo', 'dubai']);
      expect(stored?.dayCount).toBe(2);

      const detail = await itineraries.getById(created._id, owner.id);
      expect(detail.cityGroups).toEqual([
        expect.objectContaining({ cityId: 'dubai', fromDay: 1, toDay: 1 }),
        expect.objectContaining({ cityId: 'cairo', fromDay: 2, toDay: 2 }),
      ]);
    });

    it('leaves omitted fields unchanged, and an empty body changes nothing', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const day = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo', notes: 'Arrival' }),
        owner.id,
      );

      const notesOnly = await itineraries.updateDay(
        created._id,
        day._id,
        { notes: 'Late arrival' },
        owner.id,
      );
      expect(notesOnly).toMatchObject({
        cityId: 'cairo',
        notes: 'Late arrival',
      });

      const untouched = await itineraries.updateDay(
        created._id,
        day._id,
        {},
        owner.id,
      );
      expect(untouched).toEqual(notesOnly);
    });

    it('rejects an unknown city and over-long notes with 400', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const day = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo' }),
        owner.id,
      );

      for (const [body, field] of [
        [{ cityId: 'nowhere' }, 'cityId'],
        [{ cityId: '   ' }, 'cityId'],
        [{ notes: 'n'.repeat(2001) }, 'notes'],
      ] as const) {
        const error = await itineraries
          .updateDay(created._id, day._id, body, owner.id)
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        expect(errorDetails(error).details[0].field).toBe(field);
      }
    });

    it('returns 404 for a foreign itinerary, an unknown day and a day of another itinerary', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const intruder = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const other = await itineraries.create(
        createDto({ title: 'Another trip' }),
        owner.id,
      );
      const day = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo' }),
        owner.id,
      );
      const otherDay = await itineraries.addDay(
        other._id,
        dayDto({ cityId: 'dubai' }),
        owner.id,
      );

      for (const [itineraryId, dayId, userId] of [
        [created._id, day._id, intruder.id],
        [created._id, new Types.ObjectId().toHexString(), owner.id],
        [created._id, otherDay._id, owner.id],
      ] as const) {
        await expect(
          itineraries.updateDay(
            itineraryId,
            dayId,
            { cityId: 'dubai' },
            userId,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
    });

    it('rejects malformed IDs with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const day = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo' }),
        owner.id,
      );

      for (const [itineraryId, dayId] of [
        ['not-an-id', day._id],
        [created._id, 'not-an-id'],
      ]) {
        await expect(
          itineraries.updateDay(
            itineraryId,
            dayId,
            { cityId: 'dubai' },
            owner.id,
          ),
        ).rejects.toMatchObject({
          response: { code: ErrorCode.ValidationFailed },
        });
      }
    });
  });

  describe('cityGroups (ITN-09)', () => {
    it('groups consecutive same-city days and dates them from the start date', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      for (const cityId of ['cairo', 'cairo', 'dubai', 'cairo']) {
        await itineraries.addDay(created._id, dayDto({ cityId }), owner.id);
      }

      const detail = await itineraries.getById(created._id, owner.id);

      expect(detail.cityGroups).toEqual([
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
        {
          cityId: 'cairo',
          fromDay: 4,
          toDay: 4,
          dayCount: 1,
          checkIn: '2027-04-04',
          checkOut: '2027-04-05',
        },
      ]);
    });

    it('moves every day and group date when the start date changes', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo' }),
        owner.id,
      );
      await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo' }),
        owner.id,
      );

      const updated = await itineraries.update(
        created._id,
        { startDate: '2027-04-10' },
        owner.id,
      );

      expect(updated.days.map((day) => day.date)).toEqual([
        '2027-04-10',
        '2027-04-11',
      ]);
      expect(updated.cityGroups).toEqual([
        expect.objectContaining({
          checkIn: '2027-04-10',
          checkOut: '2027-04-12',
        }),
      ]);
    });
  });

  describe('deleteDay (ITN-07)', () => {
    it('deletes the day with its activities, budgets and transport costs, then renumbers, re-dates and regroups the rest', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const seeded = await seedTrip(created._id);
      const [first, middle, last] = seeded.dayIds;

      await itineraries.deleteDay(created._id, middle, owner.id);

      const detail = await itineraries.getById(created._id, owner.id);
      expect(detail.days.map((day) => day._id)).toEqual([first, last]);
      expect(detail.days.map((day) => day.dayNumber)).toEqual([1, 2]);
      expect(detail.days.map((day) => day.date)).toEqual([
        '2027-04-01',
        '2027-04-02',
      ]);
      expect(detail.days.map((day) => day.cityId)).toEqual(['cairo', 'cairo']);
      expect(
        detail.days.map((day) => day.activities.map((a) => a.name)),
      ).toEqual([['cairo 1'], ['cairo 3']]);
      expect(detail.days.flatMap((day) => day.budgetEntries)).toHaveLength(2);
      expect(detail.transportCosts.map((cost) => cost.dayId)).toEqual([
        first,
        last,
      ]);
      expect(detail.dayCount).toBe(2);
      expect(detail.cityGroups).toEqual([
        {
          cityId: 'cairo',
          fromDay: 1,
          toDay: 2,
          dayCount: 2,
          checkIn: '2027-04-01',
          checkOut: '2027-04-03',
        },
      ]);

      const stored = await itineraryModel.findById(created._id).lean().exec();
      expect(stored?.days).toHaveLength(2);
      expect(stored?.days.flatMap((day) => day.activities)).toHaveLength(2);
      expect(stored?.days.flatMap((day) => day.budgetEntries)).toHaveLength(2);
      expect(stored?.transportCosts).toHaveLength(2);
      expect(stored?.dayCount).toBe(2);
      expect(stored?.cityIds).toEqual(['cairo']);
    });

    it('can delete the only day, leaving an empty itinerary', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const seeded = await seedTrip(created._id, ['dubai']);

      await itineraries.deleteDay(created._id, seeded.dayIds[0], owner.id);

      const detail = await itineraries.getById(created._id, owner.id);
      expect(detail.days).toEqual([]);
      expect(detail.cityGroups).toEqual([]);
      expect(detail.transportCosts).toEqual([]);
      expect(detail.dayCount).toBe(0);

      const stored = await itineraryModel.findById(created._id).lean().exec();
      expect(stored?.days).toEqual([]);
      expect(stored?.cityIds).toEqual([]);
    });

    it('returns 404 for a foreign itinerary, an unknown day and a day of another itinerary', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const intruder = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const other = await itineraries.create(
        createDto({ title: 'Another trip' }),
        owner.id,
      );
      const seeded = await seedTrip(created._id);
      const otherSeeded = await seedTrip(other._id, ['dubai']);

      for (const [itineraryId, dayId, userId] of [
        [created._id, seeded.dayIds[0], intruder.id],
        [created._id, new Types.ObjectId().toHexString(), owner.id],
        [created._id, otherSeeded.dayIds[0], owner.id],
      ] as const) {
        await expect(
          itineraries.deleteDay(itineraryId, dayId, userId),
        ).rejects.toBeInstanceOf(NotFoundException);
      }

      expect(
        (await itineraries.getById(created._id, owner.id)).days,
      ).toHaveLength(3);
    });

    it('rejects malformed IDs with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const seeded = await seedTrip(created._id);

      for (const [itineraryId, dayId] of [
        ['not-an-id', seeded.dayIds[0]],
        [created._id, 'not-an-id'],
      ] as const) {
        await expect(
          itineraries.deleteDay(itineraryId, dayId, owner.id),
        ).rejects.toMatchObject({
          response: { code: ErrorCode.ValidationFailed },
        });
      }
    });
  });

  describe('reorderDays (ITN-08)', () => {
    it('moves the days into the requested order and recalculates numbers, dates, groups, cityIds and totals', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const seeded = await seedTrip(created._id);
      const [first, middle, last] = seeded.dayIds;

      const reordered = await itineraries.reorderDays(
        created._id,
        { dayIds: [last, first, middle] },
        owner.id,
      );

      expect(reordered.days.map((day) => day._id)).toEqual([
        last,
        first,
        middle,
      ]);
      expect(reordered.days.map((day) => day.dayNumber)).toEqual([1, 2, 3]);
      expect(reordered.days.map((day) => day.date)).toEqual([
        '2027-04-01',
        '2027-04-02',
        '2027-04-03',
      ]);
      expect(reordered.days.map((day) => day.cityId)).toEqual([
        'cairo',
        'cairo',
        'dubai',
      ]);
      expect(
        reordered.days.map((day) => day.activities.map((a) => a.name)),
      ).toEqual([['cairo 3'], ['cairo 1'], ['dubai 2']]);
      expect(reordered.cityGroups).toEqual([
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
      expect(reordered.transportCosts.map((cost) => cost.dayId)).toEqual([
        first,
        middle,
        last,
      ]);

      const stored = await itineraryModel.findById(created._id).lean().exec();
      expect(stored?.dayCount).toBe(3);
      expect(stored?.cityIds).toEqual(['cairo', 'dubai']);
      expect(stored?.days.map((day) => day._id.toHexString())).toEqual([
        last,
        first,
        middle,
      ]);
      expect(
        stored?.transportCosts.map((cost) =>
          (cost as unknown as { _id: Types.ObjectId })._id.toHexString(),
        ),
      ).toEqual(seeded.costIds);
    });

    it('treats the current order as a no-op and keeps updatedAt', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const seeded = await seedTrip(created._id);
      const before = (await itineraryModel
        .findById(created._id)
        .lean()
        .exec()) as { updatedAt: Date } | null;

      const result = await itineraries.reorderDays(
        created._id,
        { dayIds: seeded.dayIds },
        owner.id,
      );

      const after = (await itineraryModel
        .findById(created._id)
        .lean()
        .exec()) as { updatedAt: Date } | null;
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
      expect(result.days.map((day) => day._id)).toEqual(seeded.dayIds);
    });

    it('accepts an empty order for an itinerary without days', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);

      const detail = await itineraries.reorderDays(
        created._id,
        { dayIds: [] },
        owner.id,
      );

      expect(detail.days).toEqual([]);
      expect(detail.cityGroups).toEqual([]);
      expect(detail.updatedAt.getTime()).toBe(created.updatedAt.getTime());
    });

    it('rejects anything that is not a permutation of the current day IDs with 400 on dayIds', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const seeded = await seedTrip(created._id);
      const [first, middle, last] = seeded.dayIds;
      const unknown = new Types.ObjectId().toHexString();

      const invalid = [
        undefined,
        'not-a-list',
        [],
        [first, middle],
        [first, middle, last, unknown],
        [first, middle, middle],
        [first, middle, unknown],
        [first, middle, 42],
        [first, middle, 'not-an-id'],
      ];

      for (const dayIds of invalid) {
        const error = await itineraries
          .reorderDays(created._id, { dayIds } as never, owner.id)
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        expect(errorDetails(error).code).toBe(ErrorCode.ValidationFailed);
        expect(errorDetails(error).details[0].field).toBe('dayIds');
      }

      const stored = await itineraryModel.findById(created._id).lean().exec();
      expect(stored?.days.map((day) => day._id.toHexString())).toEqual(
        seeded.dayIds,
      );
    });

    it('returns 404 for a foreign or unknown itinerary', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const intruder = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const seeded = await seedTrip(created._id);

      for (const [itineraryId, userId] of [
        [created._id, intruder.id],
        [new Types.ObjectId().toHexString(), owner.id],
      ] as const) {
        await expect(
          itineraries.reorderDays(
            itineraryId,
            { dayIds: seeded.dayIds },
            userId,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
    });

    it('rejects a malformed itinerary ID with 400 VALIDATION_FAILED', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);

      await expect(
        itineraries.reorderDays('not-an-id', { dayIds: [] }, owner.id),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.ValidationFailed },
      });
    });
  });

  describe('concurrent day writes (ITN-05 review)', () => {
    it('does not lose a day edit when adds overlap', async () => {
      const owner = await loginAs(t.connection, UserRole.USER);
      const created = await itineraries.create(createDto(), owner.id);
      const first = await itineraries.addDay(
        created._id,
        dayDto({ cityId: 'cairo', notes: 'original' }),
        owner.id,
      );

      const results = await Promise.allSettled([
        itineraries.addDay(created._id, dayDto({ cityId: 'dubai' }), owner.id),
        itineraries.updateDay(
          created._id,
          first._id,
          { notes: 'edited' },
          owner.id,
        ),
      ]);

      for (const result of results) expect(result.status).toBe('fulfilled');

      const detail = await itineraries.getById(created._id, owner.id);
      expect(detail.days).toHaveLength(2);
      expect(detail.days[0].notes).toBe('edited');

      const stored = await itineraryModel.findById(created._id).lean().exec();
      expect(stored?.days).toHaveLength(2);
      expect(stored?.dayCount).toBe(2);
      expect(stored?.cityIds).toEqual(['cairo', 'dubai']);
    });
  });
});
