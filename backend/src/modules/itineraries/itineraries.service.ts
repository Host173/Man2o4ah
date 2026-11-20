import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model, PipelineStage } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { paginate } from '../../common/pagination/paginate.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import type { ImageRef } from '../../common/database/image-ref.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { MAX_IMAGES_PER_ITEM } from '../storage/image-rules.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { StorageService } from '../storage/storage.service.js';
import { cityGroups, dayDate, dayNumber, orderDaysById } from './days.js';
import type { CreateDayDto } from './dto/create-day.dto.js';
import type { CreateItineraryDto } from './dto/create-itinerary.dto.js';
import type { ReorderDaysDto } from './dto/reorder-days.dto.js';
import type { UpdateDayDto } from './dto/update-day.dto.js';
import type { UpdateItineraryDto } from './dto/update-itinerary.dto.js';
import { AddActivityDto } from './dto/add-activity.dto.js';
import { UpdateActivityDto } from './dto/update-activity.dto.js';
import { validateActivityInput } from './activity-input.js';
import type {
  ActivityView,
  BudgetEntryView,
  ItineraryDayView,
  ItineraryDetailView,
  ItinerarySummary,
  PublicItineraryQuery,
  PublicItinerarySummary,
  TransportCostView,
} from './itineraries.types.js';
import {
  Itinerary,
  MAX_DAYS,
  MAX_NOTES_LENGTH,
  type Activity,
  type BudgetEntry,
  type Day,
  type TransportCost,
} from './schemas/itinerary.schema.js';

type StoredImage = ImageRef & { _id: Types.ObjectId };
type StoredActivity = Omit<Activity, 'images'> & {
  _id: Types.ObjectId;
  images: StoredImage[];
};
type StoredBudgetEntry = BudgetEntry & { _id: Types.ObjectId };
type StoredDay = Omit<Day, 'activities' | 'budgetEntries'> & {
  _id: Types.ObjectId;
  activities: StoredActivity[];
  budgetEntries: StoredBudgetEntry[];
};
type StoredTransportCost = TransportCost & { _id: Types.ObjectId };

/** An itinerary document as `.lean()` returns it: embedded IDs and timestamps included. */
type StoredItinerary = Omit<Itinerary, 'days' | 'transportCosts'> & {
  days: StoredDay[];
  transportCosts: StoredTransportCost[];
  createdAt: Date;
  updatedAt: Date;
};
type ItineraryRecord = StoredItinerary & { _id: Types.ObjectId };

const OBJECT_ID_HEX_RE = /^[0-9a-fA-F]{24}$/;
const MAX_TITLE_LENGTH = 100;

/**
 * Itinerary workflows (ITN-01, ITN-03): create, edit, delete, list the owner's
 * itineraries and open one. Every read and write is scoped by `ownerId`, so
 * another user's itinerary is a 404, never a 403 (ACC-11).
 */
@Injectable()
export class ItinerariesService {
  private readonly logger = new Logger(ItinerariesService.name);

  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<StoredItinerary>,
    private readonly referenceData: ReferenceDataService,
    private readonly storage: StorageService,
  ) {}

  /** ITN-01: creates a private itinerary owned by the authenticated user. */
  async create(
    dto: CreateItineraryDto,
    userId: string,
  ): Promise<ItineraryDetailView> {
    const ownerId = this.parseId(userId, 'userId');
    const created = await this.itineraryModel.create({
      ownerId,
      title: this.normalizeTitle(dto.title),
      countryCodes: await this.resolveCountryCodes(dto.countryCodes),
      startDate: this.parseStartDate(dto.startDate),
      dayCount: 0,
      cityIds: [],
    });
    return this.toDetailView(created.toObject() as ItineraryRecord);
  }

  /** ITN-03: the authenticated user's itineraries, most recently updated first. */
  async listMine(
    userId: string,
    query: PaginationQueryDto = new PaginationQueryDto(),
  ): Promise<Paginated<ItinerarySummary>> {
    const ownerId = this.parseId(userId, 'userId');
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const result = await paginate(
      this.itineraryModel,
      { ownerId },
      { page, limit },
      { sort: { updatedAt: -1, _id: -1 } },
    );
    return {
      ...result,
      items: result.items.map((itinerary) =>
        this.toSummary(itinerary as ItineraryRecord),
      ),
    };
  }

  /** ITN-03: opens one of the owner's itineraries with its full details. */
  async getById(
    itineraryId: string,
    userId: string,
  ): Promise<ItineraryDetailView> {
    const id = this.parseId(itineraryId, 'itineraryId');
    const ownerId = this.parseId(userId, 'userId');
    const itinerary = await this.itineraryModel
      .findOne({ _id: id, ownerId })
      .lean()
      .exec();
    if (!itinerary) throw this.notFound();
    return this.toDetailView(itinerary as ItineraryRecord);
  }

  /** ITN-01: edits the owner's title, countries or start date; other fields stay. */
  async update(
    itineraryId: string,
    dto: UpdateItineraryDto,
    userId: string,
  ): Promise<ItineraryDetailView> {
    const id = this.parseId(itineraryId, 'itineraryId');
    const ownerId = this.parseId(userId, 'userId');

    const updates: {
      title?: string;
      countryCodes?: string[];
      startDate?: Date;
    } = {};
    if (dto.title !== undefined) {
      updates.title = this.normalizeTitle(dto.title);
    }
    if (dto.countryCodes !== undefined) {
      updates.countryCodes = await this.resolveCountryCodes(dto.countryCodes);
    }
    if (dto.startDate !== undefined) {
      updates.startDate = this.parseStartDate(dto.startDate);
    }

    if (Object.keys(updates).length === 0) {
      return this.getById(itineraryId, userId);
    }

    const updated = await this.itineraryModel
      .findOneAndUpdate(
        { _id: id, ownerId },
        { $set: updates },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!updated) throw this.notFound();
    return this.toDetailView(updated as ItineraryRecord);
  }

  /**
   * ITN-01/12: deletes the owner's itinerary and the files of every activity
   * image it contained (data-model.md §3.8). References remain retryable until
   * storage cleanup succeeds. A concurrent day change returns 409 rather than
   * deleting files that were not in the cleanup snapshot.
   */
  async delete(itineraryId: string, userId: string): Promise<void> {
    const id = this.parseId(itineraryId, 'itineraryId');
    const ownerId = this.parseId(userId, 'userId');
    const itinerary = await this.itineraryModel
      .findOne({ _id: id, ownerId })
      .lean()
      .exec();
    if (!itinerary) throw this.notFound();
    await this.deleteImageFiles(this.imageKeysOf(itinerary.days ?? []));
    const deleted = await this.itineraryModel
      .findOneAndDelete({
        _id: id,
        ownerId,
        $expr: { $eq: ['$days', { $literal: itinerary.days }] },
      })
      .lean()
      .exec();
    if (!deleted) {
      if (!(await this.itineraryModel.exists({ _id: id, ownerId }).exec())) {
        throw this.notFound();
      }
      throw this.imageCleanupConflict();
    }
  }

  /**
   * ITN-05: appends a day to the owner's itinerary. Its number and date come
   * from its position, so nothing extra is stored; `dayCount` and `cityIds`
   * are recomputed in the same update (data-model.md §3.8).
   */
  async addDay(
    itineraryId: string,
    dto: CreateDayDto,
    userId: string,
  ): Promise<ItineraryDayView> {
    const id = this.parseId(itineraryId, 'itineraryId');
    const ownerId = this.parseId(userId, 'userId');

    const itinerary = await this.itineraryModel
      .findOne({ _id: id, ownerId })
      .lean()
      .exec();
    if (!itinerary) throw this.notFound();

    const cityId = await this.resolveCityId(dto.cityId);
    const notes = this.normalizeNotes(dto.notes);

    const days = itinerary.days ?? [];
    if (days.length >= MAX_DAYS) {
      throw this.invalidField(
        'days',
        `an itinerary has at most ${MAX_DAYS} days`,
      );
    }

    const day: StoredDay = {
      _id: new Types.ObjectId(),
      cityId,
      ...(notes !== undefined ? { notes } : {}),
      activities: [],
      budgetEntries: [],
    };

    // Append inside the database: both the 60-day guard and `$concatArrays`
    // re-read `days` at write time, so overlapping adds cannot overwrite each
    // other (review of ITN-05). Wrap user-supplied values in `$literal` so
    // strings starting with `$` are stored verbatim and not evaluated as
    // MongoDB expressions (e.g. `"$100 for dinner"`, `"$$ROOT"`).
    const updated = await this.itineraryModel
      .findOneAndUpdate(
        { _id: id, ownerId, [`days.${MAX_DAYS - 1}`]: { $exists: false } },
        [
          {
            $set: {
              days: {
                $concatArrays: [
                  '$days',
                  [
                    {
                      _id: day._id,
                      cityId: { $literal: cityId },
                      ...(notes !== undefined
                        ? { notes: { $literal: notes } }
                        : {}),
                      activities: day.activities,
                      budgetEntries: day.budgetEntries,
                    },
                  ],
                ],
              },
            },
          },
          ...this.recomputeDayFields(),
        ],
        { returnDocument: 'after', runValidators: true, updatePipeline: true },
      )
      .lean()
      .exec();
    if (!updated) {
      // Either the itinerary was deleted or another request filled the last
      // slot between our read and write; report the same error for a full trip.
      if (!(await this.itineraryModel.exists({ _id: id, ownerId }))) {
        throw this.notFound();
      }
      throw this.invalidField(
        'days',
        `an itinerary has at most ${MAX_DAYS} days`,
      );
    }

    const record = updated as ItineraryRecord;
    const index = record.days.length - 1;
    return this.toDayView(record.days[index], index, record.startDate);
  }

  /**
   * ITN-05: edits a day's city and notes. Omitted fields stay unchanged, and
   * an empty body returns the day untouched. A day that belongs to another
   * itinerary (or another user's) is a 404, never a 403.
   */
  async updateDay(
    itineraryId: string,
    dayId: string,
    dto: UpdateDayDto,
    userId: string,
  ): Promise<ItineraryDayView> {
    const id = this.parseId(itineraryId, 'itineraryId');
    const targetDayId = this.parseId(dayId, 'dayId');
    const ownerId = this.parseId(userId, 'userId');

    const itinerary = await this.itineraryModel
      .findOne({ _id: id, ownerId })
      .lean()
      .exec();
    if (!itinerary) throw this.notFound();

    const days = itinerary.days ?? [];
    const index = days.findIndex(
      (day) => day._id.toHexString() === targetDayId.toHexString(),
    );
    if (index === -1) throw this.notFound();

    if (dto.cityId === undefined && dto.notes === undefined) {
      return this.toDayView(days[index], index, itinerary.startDate);
    }

    const cityId =
      dto.cityId !== undefined
        ? await this.resolveCityId(dto.cityId)
        : undefined;
    const notes = this.normalizeNotes(dto.notes);

    const changes: Record<string, unknown> = {};
    if (cityId !== undefined) changes.cityId = { $literal: cityId };
    if (notes !== undefined) changes.notes = { $literal: notes };

    // Edit only the target day, using the array as it exists at write time.
    // Rewriting a read copy of the whole array lost overlapping adds (review
    // of ITN-05); `$map` merges the changes into the current document instead.
    const target = targetDayId.toHexString();
    const updated = await this.itineraryModel
      .findOneAndUpdate(
        { _id: id, ownerId, 'days._id': targetDayId },
        [
          {
            $set: {
              days: {
                $map: {
                  input: '$days',
                  as: 'day',
                  in: {
                    $cond: [
                      { $eq: ['$$day._id', targetDayId] },
                      { $mergeObjects: ['$$day', changes] },
                      '$$day',
                    ],
                  },
                },
              },
            },
          },
          ...this.recomputeDayFields(),
        ],
        { returnDocument: 'after', runValidators: true, updatePipeline: true },
      )
      .lean()
      .exec();
    if (!updated) throw this.notFound();

    const record = updated as ItineraryRecord;
    const updatedIndex = record.days.findIndex(
      (day) => day._id.toHexString() === target,
    );
    return this.toDayView(
      record.days[updatedIndex],
      updatedIndex,
      record.startDate,
    );
  }

  /** ITN-10: adds an activity to a specific day of the owner's itinerary. */
  async addActivity(
    itineraryId: string,
    dayId: string,
    dto: AddActivityDto,
    userId: string,
  ): Promise<ItineraryDayView> {
    const id = this.parseId(itineraryId, 'itineraryId');
    const ownerId = this.parseId(userId, 'userId');
    const targetDayId = this.parseId(dayId, 'dayId');
    const input = await validateActivityInput(
      AddActivityDto,
      dto,
      this.referenceData,
    );

    const activity: StoredActivity = {
      _id: new Types.ObjectId(),
      name: input.name,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.time !== undefined ? { time: input.time } : {}),
      ...(input.cost !== undefined ? { cost: { ...input.cost } } : {}),
      images: [],
    };

    const updated = await this.itineraryModel
      .findOneAndUpdate(
        { _id: id, ownerId, 'days._id': targetDayId },
        [
          {
            $set: {
              days: {
                $map: {
                  input: '$days',
                  as: 'day',
                  in: {
                    $cond: [
                      { $eq: ['$$day._id', targetDayId] },
                      {
                        $mergeObjects: [
                          '$$day',
                          {
                            activities: {
                              $concatArrays: [
                                '$$day.activities',
                                [{ $literal: activity }],
                              ],
                            },
                          },
                        ],
                      },
                      '$$day',
                    ],
                  },
                },
              },
            },
          },
          ...this.recomputeDayFields(),
        ],
        { returnDocument: 'after', updatePipeline: true },
      )
      .lean()
      .exec();
    if (!updated) throw this.notFound();
    const index = updated.days.findIndex((day) => day._id.equals(targetDayId));
    return this.toDayView(updated.days[index], index, updated.startDate);
  }

  /** ITN-10: edits only supplied fields on an activity owned by the caller. */
  async updateActivity(
    activityId: string,
    dto: UpdateActivityDto,
    userId: string,
  ): Promise<ActivityView> {
    const id = this.parseId(activityId, 'activityId');
    const ownerId = this.parseId(userId, 'userId');
    const input = await validateActivityInput(
      UpdateActivityDto,
      dto,
      this.referenceData,
    );
    const changes = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.time !== undefined ? { time: input.time } : {}),
      ...(input.cost !== undefined ? { cost: { ...input.cost } } : {}),
    };
    const filter = { ownerId, 'days.activities._id': id };
    const updated =
      Object.keys(changes).length === 0
        ? await this.itineraryModel.findOne(filter).lean().exec()
        : await this.itineraryModel
            .findOneAndUpdate(
              filter,
              [
                {
                  $set: {
                    days: {
                      $map: {
                        input: '$days',
                        as: 'day',
                        in: {
                          $mergeObjects: [
                            '$$day',
                            {
                              activities: {
                                $map: {
                                  input: '$$day.activities',
                                  as: 'activity',
                                  in: {
                                    $cond: [
                                      { $eq: ['$$activity._id', id] },
                                      {
                                        $mergeObjects: [
                                          '$$activity',
                                          { $literal: changes },
                                        ],
                                      },
                                      '$$activity',
                                    ],
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
                ...this.recomputeDayFields(),
              ],
              { returnDocument: 'after', updatePipeline: true },
            )
            .lean()
            .exec();
    if (!updated) throw this.notFound();
    const activity = updated.days
      .flatMap((day) => day.activities)
      .find((activity) => activity._id.equals(id));
    if (!activity) throw this.notFound();
    return this.toActivityView(activity);
  }

  /** ITN-10: removes an owned activity; image file handling ships with ITN-12. */
  async deleteActivity(activityId: string, userId: string): Promise<void> {
    const id = this.parseId(activityId, 'activityId');
    const ownerId = this.parseId(userId, 'userId');
    const updated = await this.itineraryModel
      .findOneAndUpdate(
        { ownerId, 'days.activities._id': id },
        [
          {
            $set: {
              days: {
                $map: {
                  input: '$days',
                  as: 'day',
                  in: {
                    $mergeObjects: [
                      '$$day',
                      {
                        activities: {
                          $filter: {
                            input: '$$day.activities',
                            as: 'activity',
                            cond: { $ne: ['$$activity._id', id] },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
          ...this.recomputeDayFields(),
        ],
        { returnDocument: 'after', updatePipeline: true },
      )
      .lean()
      .exec();
    if (!updated) throw this.notFound();
  }

  /**
   * ITN-12/GEN-08: attaches one uploaded image to the owner's activity. The
   * five-image limit is enforced atomically at write time; a file saved before
   * a rejected write is deleted again, so no orphan is left behind.
   */
  async addActivityImage(
    activityId: string,
    file: UploadedImage | undefined,
    userId: string,
  ): Promise<ItineraryDayView> {
    const id = this.parseId(activityId, 'activityId');
    const ownerId = this.parseId(userId, 'userId');
    if (!file) {
      throw this.invalidField('file', 'must contain a JPG or PNG image');
    }

    const existing = await this.itineraryModel
      .findOne({ ownerId, 'days.activities._id': id })
      .select({ days: 1 })
      .lean()
      .exec();
    if (!existing) throw this.activityNotFound();
    if (
      this.imagesOfActivity(existing.days ?? [], id).length >=
      MAX_IMAGES_PER_ITEM
    ) {
      throw this.imageLimitExceeded();
    }

    const stored = await this.storage.save(file);
    try {
      const updated = await this.itineraryModel
        .findOneAndUpdate(
          { ownerId, 'days.activities._id': id },
          { $push: { 'days.$[day].activities.$[activity].images': stored } },
          {
            arrayFilters: [
              { 'day.activities._id': id },
              { 'activity._id': id, 'activity.images.4': { $exists: false } },
            ],
            returnDocument: 'after',
            runValidators: true,
          },
        )
        .lean()
        .exec();
      if (!updated) throw this.activityNotFound();
      const day = this.activityDayView(updated as ItineraryRecord, id);
      // A document matches the main filter even when no arrayFilter matched:
      // a concurrent request may have filled the last slot after our read.
      const attached = day.activities
        .find((activity) => activity._id === id.toHexString())
        ?.images.some((image) => image._id === stored._id.toHexString());
      if (!attached) {
        const stillThere = await this.itineraryModel
          .exists({ ownerId, 'days.activities._id': id })
          .exec();
        throw stillThere ? this.imageLimitExceeded() : this.activityNotFound();
      }
      return day;
    } catch (error) {
      return await this.discardUnattachedImage(id, stored, error);
    }
  }

  /**
   * ITN-12/GEN-08: removes one image from the owner's activity. The storage
   * file goes first, so a failed database write can be retried safely because
   * `StorageService.delete` is idempotent (same order as BLG-10/HTL-01).
   */
  async removeActivityImage(
    activityId: string,
    imageId: string,
    userId: string,
  ): Promise<void> {
    const id = this.parseId(activityId, 'activityId');
    const imageObjectId = this.parseId(imageId, 'imageId');
    const ownerId = this.parseId(userId, 'userId');

    const itinerary = await this.itineraryModel
      .findOne({ ownerId, 'days.activities._id': id })
      .select({ days: 1 })
      .lean()
      .exec();
    const image = this.imagesOfActivity(itinerary?.days ?? [], id).find(
      (item) => item._id.equals(imageObjectId),
    );
    if (!image) throw this.activityNotFound();

    await this.storage.delete(image.key);
    const result = await this.itineraryModel
      .updateOne(
        {
          ownerId,
          'days.activities._id': id,
          'days.activities.images._id': imageObjectId,
        },
        {
          $pull: {
            'days.$[day].activities.$[activity].images': {
              _id: imageObjectId,
            },
          },
        },
        {
          arrayFilters: [{ 'day.activities._id': id }, { 'activity._id': id }],
          runValidators: true,
        },
      )
      .exec();
    if (!result.matchedCount) throw this.activityNotFound();
  }

  /** The day view containing an activity, with its derived number and date. */
  private activityDayView(
    itinerary: ItineraryRecord,
    activityId: Types.ObjectId,
  ): ItineraryDayView {
    const index = itinerary.days.findIndex((day) =>
      (day.activities ?? []).some(
        (activity) => activity._id.toHexString() === activityId.toHexString(),
      ),
    );
    return this.toDayView(itinerary.days[index], index, itinerary.startDate);
  }

  private imagesOfActivity(
    days: readonly StoredDay[],
    activityId: Types.ObjectId,
  ): StoredImage[] {
    for (const day of days ?? []) {
      const activity = (day.activities ?? []).find(
        (item) => item._id.toHexString() === activityId.toHexString(),
      );
      if (activity) return activity.images ?? [];
    }
    return [];
  }

  private imageKeysOf(days: readonly StoredDay[]): string[] {
    return (days ?? []).flatMap((day) =>
      (day.activities ?? []).flatMap((activity) =>
        (activity.images ?? []).map((image) => image.key),
      ),
    );
  }

  private async deleteImageFiles(keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.storage.delete(key)));
  }

  private imageLimitExceeded(): BadRequestException {
    return new BadRequestException({
      code: ErrorCode.LimitExceeded,
      message: `An activity can have at most ${MAX_IMAGES_PER_ITEM} images`,
    });
  }

  private imageCleanupConflict(): ConflictException {
    return new ConflictException({
      code: ErrorCode.ConcurrentChange,
      message: 'Itinerary changed during image cleanup. Please retry deletion.',
    });
  }

  private activityNotFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Itinerary activity not found',
    });
  }

  private async discardUnattachedImage(
    activityId: Types.ObjectId,
    image: StoredImage,
    failure: unknown,
  ): Promise<never> {
    try {
      // A rejected reply does not prove the write was rejected.
      const attached = await this.itineraryModel
        .exists({
          'days.activities._id': activityId,
          'days.activities.images': {
            $elemMatch: { _id: image._id, key: image.key },
          },
        })
        .exec();
      if (!attached) await this.storage.delete(image.key);
    } catch (cleanupError) {
      this.logger.error(
        `Image cleanup pending for activity ${activityId.toHexString()} (key ${image.key})`,
        cleanupError instanceof Error ? cleanupError.stack : undefined,
      );
    }
    throw failure;
  }

  /** Keeps the derived `dayCount` and `cityIds` in sync with a rewritten `days` array. */
  private recomputeDayFields(): PipelineStage[] {
    return [
      { $set: { dayCount: { $size: '$days' } } },
      {
        $set: {
          cityIds: {
            $sortArray: { input: { $setUnion: ['$days.cityId'] }, sortBy: 1 },
          },
        },
      },
    ];
  }

  /**
   * ITN-07: deletes a day of the owner's itinerary. The day's activities and
   * budget entries are embedded, so they go with it; transport costs are in a
   * separate array and are filtered by `dayId` in the same update, which keeps
   * the schema's day-link validation happy. Numbers and dates are derived on
   * read, so the remaining days renumber and re-date themselves.
   *
   * ITN-12 deletes the image files of the activities that went with the day;
   * budget summaries are owned by ITN-14/18.
   */
  async deleteDay(
    itineraryId: string,
    dayId: string,
    userId: string,
  ): Promise<void> {
    const id = this.parseId(itineraryId, 'itineraryId');
    const targetDayId = this.parseId(dayId, 'dayId');
    const ownerId = this.parseId(userId, 'userId');

    const itinerary = await this.itineraryModel
      .findOne({ _id: id, ownerId })
      .lean()
      .exec();
    if (!itinerary) throw this.notFound();

    const days = itinerary.days ?? [];
    const target = targetDayId.toHexString();
    const removed = days.find((day) => day._id.toHexString() === target);
    if (!removed) throw this.notFound();
    const imageKeys = this.imageKeysOf([removed]);
    await this.deleteImageFiles(imageKeys);
    // The schema checks that every transportCosts.dayId is one of `days`, so
    // both arrays must be rewritten in the same update. The pipeline re-reads
    // them at write time: an overlapping add/edit to another day is preserved.
    const updated = await this.itineraryModel
      .findOneAndUpdate(
        {
          _id: id,
          ownerId,
          $expr: {
            $eq: [
              {
                $filter: {
                  input: '$days',
                  as: 'day',
                  cond: { $eq: ['$$day._id', targetDayId] },
                },
              },
              { $literal: [removed] },
            ],
          },
        },
        [
          {
            $set: {
              days: {
                $filter: {
                  input: '$days',
                  as: 'day',
                  cond: { $ne: ['$$day._id', targetDayId] },
                },
              },
            },
          },
          {
            $set: {
              transportCosts: {
                $filter: {
                  input: '$transportCosts',
                  as: 'cost',
                  cond: { $ne: ['$$cost.dayId', targetDayId] },
                },
              },
            },
          },
          ...this.recomputeDayFields(),
        ],
        { returnDocument: 'after', updatePipeline: true, runValidators: true },
      )
      .lean()
      .exec();
    if (!updated) {
      const exists = await this.itineraryModel
        .exists({ _id: id, ownerId, 'days._id': targetDayId })
        .exec();
      if (!exists) throw this.notFound();
      throw this.imageCleanupConflict();
    }
  }

  /**
   * ITN-08: moves a day by replacing the `days` array with the requested
   * permutation in one update. Only the order changes: the embedded details
   * travel with each day, while numbers, dates and city groups are derived on
   * read. The current order is a no-op and does not bump `updatedAt`.
   */
  async reorderDays(
    itineraryId: string,
    dto: ReorderDaysDto,
    userId: string,
  ): Promise<ItineraryDetailView> {
    const id = this.parseId(itineraryId, 'itineraryId');
    const ownerId = this.parseId(userId, 'userId');

    const itinerary = await this.itineraryModel
      .findOne({ _id: id, ownerId })
      .lean()
      .exec();
    if (!itinerary) throw this.notFound();

    const days = itinerary.days ?? [];
    const order = this.parseDayOrder(dto?.dayIds, days);
    const ordered = orderDaysById(days, order, (day) => day._id.toHexString());
    const unchanged = days.every(
      (day, index) =>
        day._id.toHexString() === ordered[index]._id.toHexString(),
    );
    if (unchanged) return this.toDetailView(itinerary as ItineraryRecord);

    // Rebuild the order from the array as it exists at write time: the
    // requested days first, then any day added by an overlapping request. The
    // filter requires all requested days to still exist, so a concurrent
    // delete cannot silently reorder a stale list (review of ITN-08).
    const wanted = order.map((id) => new Types.ObjectId(id));
    const updated = await this.itineraryModel
      .findOneAndUpdate(
        {
          _id: id,
          ownerId,
          $and: wanted.map((dayId) => ({ 'days._id': dayId })),
        },
        [
          {
            $set: {
              days: {
                $concatArrays: [
                  {
                    $map: {
                      input: wanted,
                      as: 'wantedId',
                      in: {
                        $arrayElemAt: [
                          '$days',
                          { $indexOfArray: ['$days._id', '$$wantedId'] },
                        ],
                      },
                    },
                  },
                  {
                    $filter: {
                      input: '$days',
                      as: 'day',
                      cond: { $not: { $in: ['$$day._id', wanted] } },
                    },
                  },
                ],
              },
            },
          },
          ...this.recomputeDayFields(),
        ],
        { returnDocument: 'after', updatePipeline: true, runValidators: true },
      )
      .lean()
      .exec();
    if (!updated) throw this.notFound();
    return this.toDetailView(updated as ItineraryRecord);
  }

  /**
   * ITN-08: `dayIds` must be a permutation of the itinerary's current day IDs.
   * Checked here as well as in the DTO because the service is used directly by
   * other modules and by tests, and only it knows the current IDs.
   */
  private parseDayOrder(value: unknown, days: readonly StoredDay[]): string[] {
    if (!Array.isArray(value)) {
      throw this.invalidField('dayIds', 'dayIds must be an array');
    }
    if (value.some((id) => typeof id !== 'string')) {
      throw this.invalidField('dayIds', 'dayIds must contain day IDs');
    }
    const ids = (value as string[]).map((id) => id.toLowerCase());
    if (ids.length !== days.length) {
      throw this.invalidField(
        'dayIds',
        `dayIds must list all ${days.length} days`,
      );
    }
    const known = new Set(days.map((day) => day._id.toHexString()));
    if (ids.some((id) => !OBJECT_ID_HEX_RE.test(id) || !known.has(id))) {
      throw this.invalidField('dayIds', 'dayIds must be current day IDs');
    }
    if (new Set(ids).size !== ids.length) {
      throw this.invalidField('dayIds', 'dayIds must not contain duplicates');
    }
    return ids;
  }

  /**
   * BLG-12: an author's public itineraries for the author page, newest
   * `updatedAt` first. Only `visibility: public` itineraries are included, and
   * hidden ones or those of a deactivated author are left out (ITN-20).
   * Returns the shared paginated shape; `page` defaults to 1 and `limit` to 10.
   * Implemented in ITN-20.
   */
  listPublicByAuthor(
    ownerId: string,
    query: PublicItineraryQuery = {},
  ): Promise<Paginated<PublicItinerarySummary>> {
    void ownerId;
    void query;
    throw new NotImplementedException(
      'listPublicByAuthor: implemented in ITN-20',
    );
  }

  private async resolveCountryCodes(codes: string[]): Promise<string[]> {
    if (!Array.isArray(codes) || codes.length === 0) {
      throw this.invalidField(
        'countryCodes',
        'countryCodes must have at least 1 item',
      );
    }
    if (codes.some((code) => typeof code !== 'string')) {
      throw this.invalidField(
        'countryCodes',
        'countryCodes must be a list of strings',
      );
    }
    if (new Set(codes).size !== codes.length) {
      throw this.invalidField(
        'countryCodes',
        'countryCodes must not contain duplicates',
      );
    }

    const countries = await this.referenceData.getCountries(codes);
    const unknown = codes.filter((code) => !countries.has(code));
    if (unknown.length > 0) {
      throw this.invalidField(
        'countryCodes',
        `Unknown country codes: ${unknown.join(', ')}`,
      );
    }
    return codes;
  }

  /** ITN-05: the city must exist in the reference dataset, and is trimmed. */
  private async resolveCityId(value: string): Promise<string> {
    if (typeof value !== 'string') {
      throw this.invalidField('cityId', 'cityId must be a string');
    }
    const cityId = value.trim();
    if (cityId.length === 0) {
      throw this.invalidField('cityId', 'cityId must not be blank');
    }
    const cities = await this.referenceData.getCities([cityId]);
    if (!cities.has(cityId)) {
      throw this.invalidField('cityId', `Unknown city: ${cityId}`);
    }
    return cityId;
  }

  /** ITN-05: notes are kept untrimmed; the limit counts code points. */
  private normalizeNotes(notes: string | undefined): string | undefined {
    if (notes === undefined) return undefined;
    if (typeof notes !== 'string') {
      throw this.invalidField('notes', 'notes must be a string');
    }
    if (Array.from(notes).length > MAX_NOTES_LENGTH) {
      throw this.invalidField(
        'notes',
        `notes must have at most ${MAX_NOTES_LENGTH} characters`,
      );
    }
    return notes;
  }

  private normalizeTitle(title: string): string {
    if (typeof title !== 'string') {
      throw this.invalidField('title', 'title must be a string');
    }
    const trimmed = title.trim();
    // Count characters, not UTF-16 code units: an emoji is one character, and
    // the DTO's `MaxLength` already counts it that way (validator.js isLength).
    const length = Array.from(trimmed).length;
    if (length < 1 || length > MAX_TITLE_LENGTH) {
      throw this.invalidField(
        'title',
        `title must be between 1 and ${MAX_TITLE_LENGTH} characters`,
      );
    }
    return trimmed;
  }

  private parseStartDate(value: string): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw this.invalidField(
        'startDate',
        'startDate must be a valid YYYY-MM-DD date',
      );
    }
    try {
      return toDateOnly(value);
    } catch {
      throw this.invalidField(
        'startDate',
        'startDate must be a valid YYYY-MM-DD date',
      );
    }
  }

  private parseId(value: string, field: string): Types.ObjectId {
    if (typeof value !== 'string' || !OBJECT_ID_HEX_RE.test(value)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: `Invalid ${field}`,
        details: [{ field, message: 'must be a valid ObjectId' }],
      });
    }
    return new Types.ObjectId(value);
  }

  private invalidField(field: string, message: string): BadRequestException {
    return new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [{ field, message }],
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Itinerary not found',
    });
  }

  /** Calendar dates travel as `YYYY-MM-DD` (api-contract.md §3). */
  private toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toSummary(itinerary: ItineraryRecord): ItinerarySummary {
    return {
      _id: itinerary._id.toHexString(),
      ownerId: itinerary.ownerId.toHexString(),
      title: itinerary.title,
      countryCodes: [...itinerary.countryCodes],
      startDate: this.toIsoDate(itinerary.startDate),
      dayCount: itinerary.dayCount,
      visibility: itinerary.visibility,
      createdAt: itinerary.createdAt,
      updatedAt: itinerary.updatedAt,
    };
  }

  private toDetailView(itinerary: ItineraryRecord): ItineraryDetailView {
    const days = itinerary.days ?? [];
    return {
      ...this.toSummary(itinerary),
      days: days.map((day, index) =>
        this.toDayView(day, index, itinerary.startDate),
      ),
      cityGroups: cityGroups(days, itinerary.startDate),
      transportCosts: (itinerary.transportCosts ?? []).map((cost) =>
        this.toTransportCostView(cost),
      ),
      isHidden: itinerary.isHidden,
      authorDeactivated: itinerary.authorDeactivated,
      ...(itinerary.clonedFrom
        ? {
            clonedFrom: {
              itineraryId: itinerary.clonedFrom.itineraryId.toHexString(),
              authorId: itinerary.clonedFrom.authorId.toHexString(),
            },
          }
        : {}),
    };
  }

  private toDayView(
    day: StoredDay,
    index: number,
    startDate: Date,
  ): ItineraryDayView {
    return {
      _id: day._id.toHexString(),
      dayNumber: dayNumber(index),
      date: dayDate(startDate, index),
      cityId: day.cityId,
      ...(day.notes !== undefined ? { notes: day.notes } : {}),
      activities: (day.activities ?? []).map((activity) =>
        this.toActivityView(activity),
      ),
      budgetEntries: (day.budgetEntries ?? []).map((entry) =>
        this.toBudgetEntryView(entry),
      ),
    };
  }

  private toActivityView(activity: StoredActivity): ActivityView {
    return {
      _id: activity._id.toHexString(),
      name: activity.name,
      ...(activity.description !== undefined
        ? { description: activity.description }
        : {}),
      ...(activity.time !== undefined ? { time: activity.time } : {}),
      ...(activity.cost
        ? {
            cost: {
              amountMinor: activity.cost.amountMinor,
              currency: activity.cost.currency,
            },
          }
        : {}),
      images: (activity.images ?? []).map((image) => ({
        _id: image._id.toHexString(),
        key: image.key,
        url: this.storage.urlOf(image.key),
      })),
      ...(activity.attractionId !== undefined
        ? { attractionId: activity.attractionId }
        : {}),
    };
  }

  private toBudgetEntryView(entry: StoredBudgetEntry): BudgetEntryView {
    return {
      _id: entry._id.toHexString(),
      category: entry.category,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      ...(entry.note !== undefined ? { note: entry.note } : {}),
    };
  }

  private toTransportCostView(cost: StoredTransportCost): TransportCostView {
    return {
      _id: cost._id.toHexString(),
      dayId: cost.dayId.toHexString(),
      mode: cost.mode,
      fromCityId: cost.fromCityId,
      toCityId: cost.toCityId,
      amountMinor: cost.amountMinor,
      currency: cost.currency,
    };
  }
}
