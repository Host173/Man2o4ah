import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { ReportTargetType } from '../moderation/ports/reportable-content.port.js';
import { ReportableContentRegistry } from '../moderation/ports/reportable-content.registry.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { ItinerariesModule } from './itineraries.module.js';
import { ItineraryReportableContent } from './itinerary-reportable-content.js';
import { Itinerary } from './schemas/itinerary.schema.js';

describe('ItineraryReportableContent (CTR-07, GEN-09, GEN-10, ITN-20)', () => {
  let t: TestApp;
  let provider: ItineraryReportableContent;
  let registry: ReportableContentRegistry;
  let moderation: ModerationService;
  let itineraryModel: Model<Itinerary>;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [ItinerariesModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService()),
    });
    provider = t.moduleRef.get(ItineraryReportableContent);
    registry = t.moduleRef.get(ReportableContentRegistry);
    moderation = t.moduleRef.get(ModerationService);
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
