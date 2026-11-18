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
});
