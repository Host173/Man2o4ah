import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { imageBytes } from '../../../test/support/image-fixtures.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { ReportTargetType } from '../moderation/ports/reportable-content.port.js';
import { ReportableContentRegistry } from '../moderation/ports/reportable-content.registry.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ItinerariesModule } from './itineraries.module.js';
import { ItineraryReportableContent } from './itinerary-reportable-content.js';
import { Itinerary } from './schemas/itinerary.schema.js';

describe('ItineraryReportableContent (CTR-07, GEN-09, GEN-10, ITN-20)', () => {
  let t: TestApp;
  let provider: ItineraryReportableContent;
  let registry: ReportableContentRegistry;
  let moderation: ModerationService;
  let itineraryModel: Model<Itinerary>;
  const storage = new FakeStorageService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [ItinerariesModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService())
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    provider = t.moduleRef.get(ItineraryReportableContent);
    registry = t.moduleRef.get(ReportableContentRegistry);
    moderation = t.moduleRef.get(ModerationService);
    itineraryModel = t.moduleRef.get<Model<Itinerary>>(
      getModelToken(Itinerary.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCollections(t.connection);
    for (const key of storage.keys()) await storage.delete(key);
  });

  afterAll(async () => {
    await t.close();
  }, HOOK_TIMEOUT);

  async function seedItinerary(
    overrides: Partial<Itinerary> = {},
  ): Promise<string> {
    const created = await itineraryModel.create({
      ownerId: new Types.ObjectId(),
      title: 'Public trip',
      countryCodes: ['EG'],
      startDate: toDateOnly('2027-04-01'),
      visibility: 'public',
      dayCount: 0,
      cityIds: [],
      ...overrides,
    });
    return created._id.toHexString();
  }

  async function seedWithImages(): Promise<{ id: string; keys: string[] }> {
    const images = await Promise.all(
      ['jpg', 'png'].map((type) =>
        storage.save({
          buffer: imageBytes(type === 'jpg' ? 'jpg' : 'png'),
          originalname: `trip.${type}`,
          mimetype: type === 'jpg' ? 'image/jpeg' : 'image/png',
          size: 32,
        }),
      ),
    );
    const id = await seedItinerary({
      days: images.map((image) => ({
        _id: new Types.ObjectId(),
        cityId: 'cairo',
        activities: [{ name: 'Visit', images: [image] }],
        budgetEntries: [],
      })),
      dayCount: 2,
      cityIds: ['cairo'],
    });
    return { id, keys: images.map((image) => image.key) };
  }

  it('registers itself as the itinerary provider on module init', () => {
    expect(provider.targetType).toBe(ReportTargetType.ITINERARY);
    expect(registry.get(ReportTargetType.ITINERARY)).toBe(provider);
  });

  it('exists returns true for a stored itinerary, hidden or not', async () => {
    const id = await seedItinerary();
    await expect(provider.exists(id)).resolves.toBe(true);

    await itineraryModel.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { isHidden: true } },
    );
    await expect(provider.exists(id)).resolves.toBe(true);

    await expect(
      provider.exists(new Types.ObjectId().toHexString()),
    ).resolves.toBe(false);
    await expect(provider.exists('not-an-id')).resolves.toBe(false);
  });

  it('hide marks the itinerary hidden, is idempotent and 404s when missing', async () => {
    const id = await seedItinerary();
    await provider.hide(id);
    await provider.hide(id);

    expect((await itineraryModel.findById(id).lean().exec())?.isHidden).toBe(
      true,
    );

    for (const missing of [new Types.ObjectId().toHexString(), 'not-an-id']) {
      const error = await provider
        .hide(missing)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: ErrorCode.NotFound,
      });
    }
  });

  it('delete removes the itinerary and 404s when missing or already deleted', async () => {
    const id = await seedItinerary();
    await provider.delete(id);
    await expect(itineraryModel.findById(id).lean().exec()).resolves.toBeNull();

    for (const missing of [id, new Types.ObjectId().toHexString(), 'bad']) {
      const error = await provider
        .delete(missing)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: ErrorCode.NotFound,
      });
    }
  });

  it('deletes every activity image when moderation deletes an itinerary', async () => {
    const { id, keys } = await seedWithImages();

    await moderation.deleteContent(
      ReportTargetType.ITINERARY,
      id,
      new Types.ObjectId().toHexString(),
    );

    await expect(itineraryModel.findById(id).lean().exec()).resolves.toBeNull();
    for (const key of keys) expect(storage.has(key)).toBe(false);
  });

  it('retains image references after failed moderation cleanup so deletion can be retried', async () => {
    const { id, keys } = await seedWithImages();
    vi.spyOn(storage, 'delete').mockRejectedValueOnce(
      new Error('unlink unavailable'),
    );

    await expect(provider.delete(id)).rejects.toThrow('unlink unavailable');
    const retained = await itineraryModel.findById(id).lean().exec();
    expect(
      retained?.days.flatMap((day) =>
        day.activities.flatMap((activity) =>
          activity.images.map((image) => image.key),
        ),
      ),
    ).toEqual(keys);

    await provider.delete(id);
    expect(storage.keys()).toEqual([]);
    await expect(itineraryModel.findById(id).lean().exec()).resolves.toBeNull();
  });

  it('rejects moderation deletion when a new image arrives after its cleanup snapshot', async () => {
    const { id } = await seedWithImages();
    const lateImage = await storage.save({
      buffer: imageBytes('jpg'),
      originalname: 'late.jpg',
      mimetype: 'image/jpeg',
      size: 32,
    });
    const remove = storage.delete.bind(storage);
    vi.spyOn(storage, 'delete').mockImplementationOnce(async (key) => {
      await itineraryModel.updateOne(
        { _id: id },
        { $push: { 'days.0.activities.0.images': lateImage } },
      );
      await remove(key);
    });

    await expect(provider.delete(id)).rejects.toMatchObject({
      response: { code: ErrorCode.ConcurrentChange },
    });
    await expect(provider.exists(id)).resolves.toBe(true);
    expect(storage.has(lateImage.key)).toBe(true);

    await provider.delete(id);
    expect(storage.keys()).toEqual([]);
  });

  it('lets a user report an itinerary through the moderation service (GEN-09)', async () => {
    const id = await seedItinerary();
    const reporterId = new Types.ObjectId().toHexString();

    const report = await moderation.createReport(
      { targetType: ReportTargetType.ITINERARY, targetId: id, reason: 'Spam' },
      reporterId,
    );
    expect(report).toMatchObject({
      reporterId,
      targetType: ReportTargetType.ITINERARY,
      targetId: id,
      reason: 'Spam',
    });

    await expect(
      moderation.createReport(
        {
          targetType: ReportTargetType.ITINERARY,
          targetId: id,
          reason: 'Again',
        },
        reporterId,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.AlreadyReported } });

    await expect(
      moderation.createReport(
        {
          targetType: ReportTargetType.ITINERARY,
          targetId: new Types.ObjectId().toHexString(),
          reason: 'Missing',
        },
        reporterId,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
  });
});
