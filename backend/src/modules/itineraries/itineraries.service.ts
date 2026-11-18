import {
  BadRequestException,
  Injectable,
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
import { cityGroups, dayDate, dayNumber } from './days.js';
import type { CreateDayDto } from './dto/create-day.dto.js';
import type { CreateItineraryDto } from './dto/create-itinerary.dto.js';
import type { UpdateDayDto } from './dto/update-day.dto.js';
import type { UpdateItineraryDto } from './dto/update-itinerary.dto.js';
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
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<StoredItinerary>,
    private readonly referenceData: ReferenceDataService,
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

  /** ITN-01: deletes the owner's itinerary. Image files ship with ITN-12. */
  async delete(itineraryId: string, userId: string): Promise<void> {
    const id = this.parseId(itineraryId, 'itineraryId');
    const ownerId = this.parseId(userId, 'userId');
    const deleted = await this.itineraryModel
      .findOneAndDelete({ _id: id, ownerId })
      .lean()
      .exec();
    if (!deleted) throw this.notFound();
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
                      notes:
                        notes !== undefined ? { $literal: notes } : undefined,
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
