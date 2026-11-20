import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { imageBytes } from '../../../test/support/image-fixtures.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { StorageService } from '../storage/storage.service.js';
import { ItinerariesModule } from './itineraries.module.js';
import { ItinerariesService } from './itineraries.service.js';
import { Itinerary } from './schemas/itinerary.schema.js';

const image = (name = 'pyramids.jpg'): UploadedImage => ({
  buffer: imageBytes(name.endsWith('.png') ? 'png' : 'jpg'),
  originalname: name,
  mimetype: name.endsWith('.png') ? 'image/png' : 'image/jpeg',
  size: 32,
});

describe('ITN-12 activity images (integration, storage fake)', () => {
  let t: TestApp;
  let service: ItinerariesService;
  let model: Model<Itinerary>;
  const storage = new FakeStorageService();
  const referenceData = new FakeReferenceDataService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [ItinerariesModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(referenceData)
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    service = t.moduleRef.get(ItinerariesService);
    model = t.moduleRef.get<Model<Itinerary>>(getModelToken(Itinerary.name));
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCollections(t.connection);
    for (const key of storage.keys()) await storage.delete(key);
  });

  afterAll(async () => {
    await t.close();
  }, HOOK_TIMEOUT);

  async function trip() {
    const user = await loginAs(t.connection, UserRole.USER);
    const itinerary = await service.create(
      { title: 'Cairo', countryCodes: ['EG'], startDate: '2027-04-01' },
      user.id,
    );
    const day = await service.addDay(
      itinerary._id,
      { cityId: 'cairo' },
      user.id,
    );
    const activityId = new Types.ObjectId();
    const extraDayId = new Types.ObjectId();
    await model.updateOne(
      { _id: new Types.ObjectId(itinerary._id) },
      {
        $set: {
          days: [
            {
              _id: new Types.ObjectId(day._id),
              cityId: 'cairo',
              activities: [{ _id: activityId, name: 'Pyramids', images: [] }],
              budgetEntries: [],
            },
            {
              _id: extraDayId,
              cityId: 'cairo',
              activities: [
                {
                  _id: new Types.ObjectId(),
                  name: 'Museum',
                  images: [],
                },
              ],
              budgetEntries: [],
            },
          ],
          dayCount: 2,
          cityIds: ['cairo'],
        },
      },
    );
    return {
      user,
      itineraryId: itinerary._id,
      activityId: activityId.toHexString(),
    };
  }

  it('attaches an image and stores only { _id, key }, with the file in storage', async () => {
    const { user, activityId } = await trip();

    const day = await service.addActivityImage(activityId, image(), user.id);

    expect(day.activities[0].images).toHaveLength(1);
    expect(day.activities[0].images[0]).toEqual({
      _id: expect.stringMatching(/^[0-9a-f]{24}$/),
      key: expect.stringMatching(/^[0-9a-f]{24}\.jpg$/),
      url: storage.urlOf(day.activities[0].images[0].key),
    });
    expect(storage.keys()).toEqual([day.activities[0].images[0].key]);

    const stored = await model
      .findOne({ 'days.activities._id': new Types.ObjectId(activityId) })
      .lean()
      .exec();
    expect(stored?.days[0].activities[0].images[0]).toEqual({
      _id: expect.any(Types.ObjectId),
      key: day.activities[0].images[0].key,
    });
    expect('url' in (stored?.days[0].activities[0].images[0] ?? {})).toBe(
      false,
    );
  });

  it('enforces at most 5 images per activity and rolls the 6th file back', async () => {
    const { user, activityId } = await trip();
    for (let i = 0; i < 5; i++) {
      const day = await service.addActivityImage(activityId, image(), user.id);
      expect(day.activities[0].images).toHaveLength(i + 1);
    }
    const keysBefore = [...storage.keys()];

    await expect(
      service.addActivityImage(activityId, image(), user.id),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'LIMIT_EXCEEDED' },
    });
    expect(storage.keys()).toEqual(keysBefore);
    const stored = await model
      .findOne({ 'days.activities._id': new Types.ObjectId(activityId) })
      .lean()
      .exec();
    expect(stored?.days[0].activities[0].images).toHaveLength(5);
  });

  it('rejects an invalid file without storing it', async () => {
    const { user, activityId } = await trip();
    await expect(
      service.addActivityImage(
        activityId,
        { ...image(), mimetype: 'application/pdf' },
        user.id,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(storage.keys()).toEqual([]);
  });

  it('removes an image from storage and the document, and 404s on a repeat', async () => {
    const { user, activityId } = await trip();
    const day = await service.addActivityImage(activityId, image(), user.id);
    const imageId = day.activities[0].images[0]._id;
    const key = day.activities[0].images[0].key;

    await expect(
      service.removeActivityImage(activityId, imageId, user.id),
    ).resolves.toBeUndefined();
    expect(storage.has(key)).toBe(false);
    const stored = await model
      .findOne({ 'days.activities._id': new Types.ObjectId(activityId) })
      .lean()
      .exec();
    expect(stored?.days[0].activities[0].images).toEqual([]);

    await expect(
      service.removeActivityImage(activityId, imageId, user.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('deletes every activity image file when an itinerary is deleted', async () => {
    const { user, itineraryId, activityId } = await trip();
    await service.addActivityImage(activityId, image('one.jpg'), user.id);
    // A second image on another day's activity.
    const other = await model
      .findOne({ _id: new Types.ObjectId(itineraryId) })
      .lean()
      .exec();
    const otherActivityId = (
      other!.days[1].activities[0] as unknown as { _id: Types.ObjectId }
    )._id;
    await service.addActivityImage(
      otherActivityId.toHexString(),
      image('two.png'),
      user.id,
    );
    expect(storage.keys()).toHaveLength(2);

    await service.delete(itineraryId, user.id);

    expect(storage.keys()).toEqual([]);
    expect(await model.findById(itineraryId).lean().exec()).toBeNull();
  });

  it('deletes only the removed day’s activity image files', async () => {
    const { user, itineraryId, activityId } = await trip();
    const first = await service.addActivityImage(
      activityId,
      image('one.jpg'),
      user.id,
    );
    const itinerary = await model.findById(itineraryId).lean().exec();
    const otherDayId = itinerary!.days[1]._id;
    const otherActivityId = (
      itinerary!.days[1].activities[0] as unknown as { _id: Types.ObjectId }
    )._id;
    const second = await service.addActivityImage(
      otherActivityId.toHexString(),
      image('two.png'),
      user.id,
    );

    await service.deleteDay(
      itineraryId,
      itinerary!.days[0]._id.toHexString(),
      user.id,
    );

    const remainingKey = second.activities[0].images[0].key;
    expect(storage.keys()).toEqual([remainingKey]);
    expect(storage.has(first.activities[0].images[0].key)).toBe(false);
    const remaining = await service.getById(itineraryId, user.id);
    expect(remaining.days.map((day) => day._id)).toEqual([
      otherDayId.toHexString(),
    ]);
    expect(remaining.days[0].activities[0].images[0].key).toBe(remainingKey);
  });

  it.each(['itinerary', 'day'] as const)(
    'keeps the %s reachable after an unlink failure so deletion can be retried',
    async (parent) => {
      const { user, itineraryId, activityId } = await trip();
      const added = await service.addActivityImage(
        activityId,
        image(),
        user.id,
      );
      const key = added.activities[0].images[0].key;
      const remove = () =>
        parent === 'itinerary'
          ? service.delete(itineraryId, user.id)
          : service.deleteDay(itineraryId, added._id, user.id);
      vi.spyOn(storage, 'delete').mockRejectedValueOnce(
        new Error('unlink unavailable'),
      );

      await expect(remove()).rejects.toThrow('unlink unavailable');
      const retained = await service.getById(itineraryId, user.id);
      expect(retained.days[0].activities[0].images[0].key).toBe(key);
      expect(storage.has(key)).toBe(true);

      await remove();
      expect(storage.has(key)).toBe(false);
      if (parent === 'itinerary') {
        await expect(
          service.getById(itineraryId, user.id),
        ).rejects.toMatchObject({ status: 404 });
      } else {
        const remaining = await service.getById(itineraryId, user.id);
        expect(remaining.days).toHaveLength(1);
      }
    },
  );

  it('rejects a day deletion when an image is attached after its cleanup snapshot', async () => {
    const { user, itineraryId, activityId } = await trip();
    const added = await service.addActivityImage(activityId, image(), user.id);
    const update = model.findOneAndUpdate.bind(model);
    vi.spyOn(model, 'findOneAndUpdate').mockImplementationOnce(
      (filter, updates, options) => {
        const query = update(filter, updates, options);
        const exec = query.exec.bind(query);
        vi.spyOn(query, 'exec').mockImplementationOnce(async () => {
          await service.addActivityImage(
            activityId,
            image('late.png'),
            user.id,
          );
          return exec();
        });
        return query;
      },
    );

    await expect(
      service.deleteDay(itineraryId, added._id, user.id),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONCURRENT_CHANGE' },
    });
    const retained = await service.getById(itineraryId, user.id);
    const lateKey = retained.days[0].activities[0].images[1].key;
    expect(storage.has(lateKey)).toBe(true);
    await service.deleteDay(itineraryId, added._id, user.id);
    expect(storage.keys()).toEqual([]);
  });

  it('rejects itinerary deletion when its days change after the cleanup snapshot', async () => {
    const { user, itineraryId, activityId } = await trip();
    const remove = model.findOneAndDelete.bind(model);
    vi.spyOn(model, 'findOneAndDelete').mockImplementationOnce(
      (filter, options) => {
        const query = remove(filter, options);
        const exec = query.exec.bind(query);
        vi.spyOn(query, 'exec').mockImplementationOnce(async () => {
          await service.addActivityImage(activityId, image(), user.id);
          return exec();
        });
        return query;
      },
    );

    await expect(service.delete(itineraryId, user.id)).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONCURRENT_CHANGE' },
    });
    const retained = await service.getById(itineraryId, user.id);
    expect(storage.has(retained.days[0].activities[0].images[0].key)).toBe(
      true,
    );
    await service.delete(itineraryId, user.id);
    expect(storage.keys()).toEqual([]);
  });

  it('scopes images to the owner: another user gets 404 and files stay', async () => {
    const { user, itineraryId, activityId } = await trip();
    const other = await loginAs(t.connection, UserRole.USER);
    await service.addActivityImage(activityId, image(), user.id);

    await expect(
      service.addActivityImage(activityId, image(), other.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.removeActivityImage(
        activityId,
        new Types.ObjectId().toHexString(),
        other.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.delete(itineraryId, other.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(storage.keys()).toHaveLength(1);
  });

  it('caps concurrent adds at 5 with no orphan files (review probe)', async () => {
    const { user, activityId } = await trip();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.addActivityImage(activityId, image(), user.id),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(storage.keys()).toHaveLength(5);
    const stored = await model
      .findOne({ 'days.activities._id': new Types.ObjectId(activityId) })
      .lean()
      .exec();
    expect(stored?.days[0].activities[0].images).toHaveLength(5);
  });

  it('a duplicate concurrent removal answers 404 once (review probe)', async () => {
    const { user, activityId } = await trip();
    const day = await service.addActivityImage(activityId, image(), user.id);
    const imageId = day.activities[0].images[0]._id;
    const results = await Promise.allSettled([
      service.removeActivityImage(activityId, imageId, user.id),
      service.removeActivityImage(activityId, imageId, user.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(storage.keys()).toEqual([]);
  });
});
