import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
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

describe('HotelsService (HTL-01 integration)', () => {
  let t: TestApp;
  let service: HotelsService;
  let hotels: Model<Hotel>;
  let referenceData: FakeReferenceDataService;

  beforeAll(async () => {
    referenceData = new FakeReferenceDataService();
    t = await createTestApp({
      imports: [HotelsModule],
      override: (builder) =>
        builder.overrideProvider(ReferenceDataService).useValue(referenceData),
    });
    service = t.moduleRef.get(HotelsService);
    hotels = t.moduleRef.get<Model<Hotel>>(getModelToken(Hotel.name));
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    vi.restoreAllMocks();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('persists a profile, derives country from the reference city, and returns the existing contract shape', async () => {
    const created = await service.create({
      ...profile,
      name: '  Nile View Hotel  ',
      address: '  1 Corniche El Nil  ',
      amenities: ['  Wi-Fi  ', 'Pool'],
    });
    expect(created).toEqual({
      ...profile,
      id: expect.any(String),
      countryCode: 'EG',
      photos: [],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationPolicy: { tiers: [] },
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    });
    const stored = await hotels.findById(created.id).lean().exec();
    expect(stored).toMatchObject({ name: profile.name, countryCode: 'EG' });
    expect(stored).not.toHaveProperty('id');
  });

  it('returns null for an unknown valid ID and does not hide inactive hotels from internal callers', async () => {
    expect(
      await service.getHotel(new Types.ObjectId().toHexString()),
    ).toBeNull();
    const created = await service.create(profile);
    await service.setActive(created.id, false);
    expect(await service.getHotel(created.id)).toMatchObject({
      isActive: false,
    });
  });

  it('rejects unknown cities without creating or partially editing a hotel', async () => {
    await expect(
      service.create({ ...profile, cityId: 'missing' }),
    ).rejects.toMatchObject({
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'cityId', message: expect.any(String) }],
      },
    });
    expect(await hotels.countDocuments()).toBe(0);
    const created = await service.create(profile);
    await expect(
      service.update(
        created.id,
        { name: 'Must not persist', cityId: 'missing' },
        created.id,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('allowlists profile inputs so direct callers cannot override protected fields', async () => {
    const input = {
      name: 'Minimal',
      address: 'Address',
      cityId: 'cairo',
      countryCode: 'US',
      isActive: false,
      ratingSummary: { average: 5, count: 100 },
      photos: [{ _id: new Types.ObjectId(), key: 'unexpected.jpg' }],
      checkInTime: '01:00',
      cancellationPolicy: { tiers: [{ daysBefore: 0, refundPercent: 100 }] },
    };
    const created = await service.create(input);
    expect(created).toMatchObject({
      countryCode: 'EG',
      isActive: true,
      ratingSummary: { average: null, count: 0 },
      photos: [],
      amenities: [],
      checkInTime: '14:00',
      cancellationPolicy: { tiers: [] },
    });
    expect(created).not.toHaveProperty('description');
    expect(created).not.toHaveProperty('starRating');
    expect(await service.update(created.id, input, created.id)).toEqual(
      created,
    );
  });

  it('edits only supplied profile fields and updates country when the city changes', async () => {
    const created = await service.create(profile);
    const updated = await service.update(
      created.id,
      { name: '  Dubai View  ', cityId: 'dubai' },
      created.id,
    );
    expect(updated).toEqual({
      ...created,
      name: 'Dubai View',
      cityId: 'dubai',
      countryCode: 'AE',
    });
  });

  it('supports description, star-rating, address, and amenities edits including explicit empty lists', async () => {
    const created = await service.create(profile);
    const updated = await service.update(
      created.id,
      {
        address: '  New Address  ',
        description: '',
        starRating: 5,
        amenities: [],
      },
      created.id,
    );
    expect(updated).toMatchObject({
      address: 'New Address',
      description: '',
      starRating: 5,
      amenities: [],
    });
    expect(await service.update(created.id, {}, created.id)).toEqual(updated);
  });

  it('rejects edits to another moderator hotel before performing reference lookups', async () => {
    const created = await service.create(profile);
    const lookup = vi.spyOn(referenceData, 'getCity');
    await expect(
      service.update(
        created.id,
        { cityId: 'dubai' },
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    expect(lookup).not.toHaveBeenCalled();
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('reports missing hotels for editing, activation, and rating updates', async () => {
    const id = new Types.ObjectId().toHexString();
    for (const call of [
      () => service.update(id, { name: 'Missing' }, id),
      () => service.setActive(id, false),
      () => service.setRatingSummary(id, { average: 4, count: 1 }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        response: { code: ErrorCode.NotFound },
      });

      it('refuses edits without a valid trusted moderator assignment', async () => {
        const created = await service.create(profile);
        for (const assignment of [undefined, '', 'not-an-objectid']) {
          await expect(
            service.update(created.id, { name: 'Denied' }, assignment),
          ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
        }
        expect(await service.getHotel(created.id)).toEqual(created);
      });
    }
  });

  it('changes activation and ratings without overwriting profile, policy, or photo fields', async () => {
    const created = await service.create(profile);
    const photoId = new Types.ObjectId();
    await hotels.updateOne(
      { _id: created.id },
      {
        $set: {
          photos: [{ _id: photoId, key: 'test.jpg' }],
          cancellationPolicy: {
            tiers: [{ daysBefore: 7, refundPercent: 100 }],
          },
        },
      },
    );
    await service.setActive(created.id, false);
    await service.setRatingSummary(created.id, { average: 4.5, count: 2 });
    expect(await service.getHotel(created.id)).toMatchObject({
      ...profile,
      isActive: false,
      ratingSummary: { average: 4.5, count: 2 },
      photos: [{ id: photoId.toHexString(), key: 'test.jpg' }],
      cancellationPolicy: { tiers: [{ daysBefore: 7, refundPercent: 100 }] },
    });
    await service.setActive(created.id, true);
    await service.setRatingSummary(created.id, { average: null, count: 0 });
    expect(await service.getHotel(created.id)).toMatchObject({
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    });
  });

  it('honors the caller transaction for hotel reads and activation/rating writes', async () => {
    const created = await service.create(profile);
    const session = await t.connection.startSession();
    try {
      session.startTransaction();
      await service.setActive(created.id, false, { session });
      await service.setRatingSummary(
        created.id,
        { average: 5, count: 1 },
        { session },
      );
      expect(await service.getHotel(created.id, { session })).toMatchObject({
        isActive: false,
        ratingSummary: { average: 5, count: 1 },
      });
      expect(await service.getHotel(created.id)).toMatchObject({
        isActive: true,
        ratingSummary: { average: null, count: 0 },
      });
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('rejects malformed hotel IDs with explicit validation errors', async () => {
    await expect(service.getHotel('not-an-objectid')).rejects.toMatchObject({
      response: { code: ErrorCode.ValidationFailed },
    });
  });

  it('does not allow database schema validation failures to become successful updates', async () => {
    const created = await service.create(profile);
    await expect(
      service.update(created.id, { starRating: 6 }, created.id),
    ).rejects.toThrow();
    expect(await service.getHotel(created.id)).toEqual(created);
  });
});
