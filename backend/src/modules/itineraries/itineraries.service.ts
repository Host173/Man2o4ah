import {
  BadRequestException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { paginate } from '../../common/pagination/paginate.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import type { ImageRef } from '../../common/database/image-ref.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import type { CreateItineraryDto } from './dto/create-itinerary.dto.js';
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

  private normalizeTitle(title: string): string {
    if (typeof title !== 'string') {
      throw this.invalidField('title', 'title must be a string');
    }
    const trimmed = title.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_TITLE_LENGTH) {
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
    return {
      ...this.toSummary(itinerary),
      days: (itinerary.days ?? []).map((day, index) =>
        this.toDayView(day, index, itinerary.startDate),
      ),
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
      dayNumber: index + 1,
      date: this.toIsoDate(addDays(startDate, index)),
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
