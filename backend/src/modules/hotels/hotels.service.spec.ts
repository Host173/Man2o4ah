import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { MAX_IMAGE_BYTES } from '../storage/image-rules.js';
import type { UploadedImage } from '../storage/image-rules.js';
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

describe('HotelsService (HTL-01 integration)', () => {
  let t: TestApp;
  let service: HotelsService;
  let hotels: Model<Hotel>;
  let referenceData: FakeReferenceDataService;
  const storage = new FakeStorageService();

  beforeAll(async () => {
    referenceData = new FakeReferenceDataService();
    t = await createTestApp({
      imports: [HotelsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(referenceData)
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    service = t.moduleRef.get(HotelsService);
    hotels = t.moduleRef.get<Model<Hotel>>(getModelToken(Hotel.name));
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    vi.restoreAllMocks();
    await Promise.all(storage.keys().map((key) => storage.delete(key)));
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  describe('hotel photos', () => {
    const image: UploadedImage = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      originalname: 'hotel.jpg',
      mimetype: 'image/jpeg',
      size: 4,
    };

    it('stores image references and removes both the file and reference', async () => {
      const created = await service.create(profile);
      const updated = await service.addPhoto(created.id, image, created.id);
      const photo = updated.photos[0]!;
      expect(updated.photos).toHaveLength(1);
      expect(storage.bytesOf(photo.key)).toEqual(image.buffer);
      expect((await service.getHotel(created.id))?.photos).toEqual(
        updated.photos,
      );
      await service.removePhoto(created.id, photo.id, created.id);
      expect(storage.has(photo.key)).toBe(false);
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
    });

    it('keeps exactly five photos under concurrent uploads and removes rejected files', async () => {
      const created = await service.create(profile);
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          service.addPhoto(created.id, image, created.id),
        ),
      );
      expect(
        outcomes.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(5);
      const rejected = outcomes.filter(
        (result) => result.status === 'rejected',
      );
      expect(rejected).toHaveLength(3);
      for (const result of rejected) {
        expect(result.reason).toMatchObject({
          status: 400,
          response: { code: ErrorCode.LimitExceeded },
        });
      }
      const photos = (await service.getHotel(created.id))!.photos;
      expect(photos).toHaveLength(5);
      expect(new Set(photos.map((photo) => photo.id)).size).toBe(5);
      expect(storage.keys().sort()).toEqual(
        photos.map((photo) => photo.key).sort(),
      );
      await service.removePhoto(created.id, photos[0]!.id, created.id);
      expect(
        (await service.addPhoto(created.id, image, created.id)).photos,
      ).toHaveLength(5);
    });

    it('checks moderator scope and existence before accessing storage', async () => {
      const created = await service.create(profile);
      const photo = (await service.addPhoto(created.id, image, created.id))
        .photos[0]!;
      const save = vi.spyOn(storage, 'save');
      const remove = vi.spyOn(storage, 'delete');
      const missing = new Types.ObjectId().toHexString();
      for (const assignment of [undefined, missing]) {
        await expect(
          service.addPhoto(created.id, image, assignment),
        ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
        await expect(
          service.removePhoto(created.id, photo.id, assignment),
        ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      }
      await expect(
        service.addPhoto(missing, image, missing),
      ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      await expect(
        service.removePhoto(created.id, missing, created.id),
      ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      expect(save).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(storage.has(photo.key)).toBe(true);
    });

    it('rejects missing, empty, unsupported and oversized images without attaching a photo', async () => {
      const created = await service.create(profile);
      for (const file of [
        undefined,
        { ...image, size: 0, buffer: Buffer.alloc(0) },
        { ...image, mimetype: 'application/pdf' },
        { ...image, size: MAX_IMAGE_BYTES + 1 },
      ]) {
        await expect(
          service.addPhoto(created.id, file, created.id),
        ).rejects.toMatchObject({
          response: { code: ErrorCode.ValidationFailed },
        });
      }
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
      expect(storage.keys()).toEqual([]);
    });

    it('never removes a photo belonging to a different hotel', async () => {
      const created = await service.create(profile);
      const other = await service.create({ ...profile, name: 'Other Hotel' });
      const photo = (await service.addPhoto(other.id, image, other.id))
        .photos[0]!;
      await expect(
        service.removePhoto(created.id, photo.id, created.id),
      ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      expect((await service.getHotel(other.id))?.photos).toEqual([photo]);
      expect(storage.has(photo.key)).toBe(true);
    });

    it('cleans up an unattached upload when the database write fails', async () => {
      const created = await service.create(profile);
      const failure = new Error('Photo database write failed');
      vi.spyOn(hotels.collection, 'findOneAndUpdate').mockRejectedValueOnce(
        failure,
      );
      await expect(
        service.addPhoto(created.id, image, created.id),
      ).rejects.toBe(failure);
      expect(storage.keys()).toEqual([]);
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
    });

    it('does not delete an attached file when the database reply is lost after writing', async () => {
      const created = await service.create(profile);
      const failure = new Error('Photo database reply lost');
      const write = hotels.collection.findOneAndUpdate.bind(hotels.collection);
      vi.spyOn(hotels.collection, 'findOneAndUpdate').mockImplementationOnce(
        async (...args) => {
          await write(...args);
          throw failure;
        },
      );
      await expect(
        service.addPhoto(created.id, image, created.id),
      ).rejects.toBe(failure);
      const photos = (await service.getHotel(created.id))!.photos;
      expect(photos).toHaveLength(1);
      expect(storage.has(photos[0]!.key)).toBe(true);
    });

    it('surfaces both errors if an unsuccessful upload cannot be cleaned up', async () => {
      const created = await service.create(profile);
      const writeFailure = new Error('Photo database write failed');
      const cleanupFailure = new Error('Photo storage cleanup failed');
      vi.spyOn(hotels.collection, 'findOneAndUpdate').mockRejectedValueOnce(
        writeFailure,
      );
      vi.spyOn(storage, 'delete').mockRejectedValueOnce(cleanupFailure);
      await expect(
        service.addPhoto(created.id, image, created.id),
      ).rejects.toMatchObject({
        errors: [writeFailure, cleanupFailure],
      });
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
      expect(storage.keys()).toHaveLength(1);
    });

    it('cleans an upload if its hotel disappears before attachment', async () => {
      const created = await service.create(profile);
      const save = storage.save.bind(storage);
      vi.spyOn(storage, 'save').mockImplementationOnce(async (file) => {
        const stored = await save(file);
        await hotels.deleteOne({ _id: created.id });
        return stored;
      });
      await expect(
        service.addPhoto(created.id, image, created.id),
      ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      expect(storage.keys()).toEqual([]);
    });

    it('preserves the reference on a storage deletion failure and permits a retry', async () => {
      const created = await service.create(profile);
      const photo = (await service.addPhoto(created.id, image, created.id))
        .photos[0]!;
      const failure = new Error('Photo deletion failed');
      vi.spyOn(storage, 'delete').mockRejectedValueOnce(failure);
      await expect(
        service.removePhoto(created.id, photo.id, created.id),
      ).rejects.toBe(failure);
      expect(storage.has(photo.key)).toBe(true);
      expect((await service.getHotel(created.id))?.photos).toEqual([photo]);
      await service.removePhoto(created.id, photo.id, created.id);
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
      expect(storage.keys()).toEqual([]);
    });

    it('retains the key for retry if the database removal fails after deleting the file', async () => {
      const created = await service.create(profile);
      const photo = (await service.addPhoto(created.id, image, created.id))
        .photos[0]!;
      const failure = new Error('Photo reference removal failed');
      vi.spyOn(hotels.collection, 'updateOne').mockRejectedValueOnce(failure);
      await expect(
        service.removePhoto(created.id, photo.id, created.id),
      ).rejects.toBe(failure);
      expect((await service.getHotel(created.id))?.photos).toEqual([photo]);
      expect(storage.has(photo.key)).toBe(false);
      await service.removePhoto(created.id, photo.id, created.id);
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
    });

    it('handles simultaneous deletions without losing other photos', async () => {
      const created = await service.create(profile);
      await service.addPhoto(created.id, image, created.id);
      const photos = (await service.addPhoto(created.id, image, created.id))
        .photos;
      const results = await Promise.allSettled([
        service.removePhoto(created.id, photos[0]!.id, created.id),
        service.removePhoto(created.id, photos[0]!.id, created.id),
      ]);
      expect(results.some((result) => result.status === 'fulfilled')).toBe(
        true,
      );
      expect((await service.getHotel(created.id))?.photos).toEqual([photos[1]]);
      expect(storage.keys()).toEqual([photos[1]!.key]);
    });
  });

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
    }
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
