import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { mongo, Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { addDays, daysBetween } from '../../common/dates/date-only.js';
import { toPage } from '../../common/pagination/paginated.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { paginate } from '../../common/pagination/paginate.js';
import type { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { escapeRegex } from '../../common/text/escape-regex.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { MAX_IMAGES_PER_ITEM } from '../storage/image-rules.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { StorageService } from '../storage/storage.service.js';
import type { StoredImage } from '../storage/storage.service.js';
import type { CreateHotelDto } from './dto/create-hotel.dto.js';
import type { CreateRoomDto } from './dto/create-room.dto.js';
import type { RoomBlockOperationDto } from './dto/room-block-operation.dto.js';
import type { RoomBlockResponseDto } from './dto/room-block-operation.dto.js';
import type {
  RoomAvailabilityDto,
  SetRoomAvailabilityDto,
} from './dto/room-availability.dto.js';
import type { UpdateRoomDto } from './dto/update-room.dto.js';
import type { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto.js';
import type { UpdateHotelDto } from './dto/update-hotel.dto.js';
import type {
  AvailableRoomView,
  HotelSearchQuery,
  HotelSearchResult,
  HotelTransactionOptions,
  HotelView,
  RoomDateRange,
  RoomNightView,
  RoomView,
} from './hotels.types.js';
import {
  assertDateRange,
  assertStayDates,
  parseAvailabilityRange,
} from './room-date-ranges.js';
import { RoomNightInventory } from './room-night-inventory.js';
import { Hotel } from './schemas/hotel.schema.js';
import type { RatingSummary } from './schemas/hotel.schema.js';
import { Room } from './schemas/room.schema.js';
import { RoomNight, RoomNightKind } from './schemas/room-night.schema.js';
import { parseRoomBlockOperation } from './room-block-operation.js';
import { cheapestQualifyingRoomPrice } from './hotel-search-pricing.js';

type StoredHotel = Omit<Hotel, 'photos'> & {
  photos: (Hotel['photos'][number] & { _id: Types.ObjectId })[];
};
type HotelRecord = StoredHotel & { _id: Types.ObjectId };
type ProfileFields = Pick<
  Hotel,
  | 'name'
  | 'address'
  | 'cityId'
  | 'countryCode'
  | 'description'
  | 'starRating'
  | 'amenities'
>;

@Injectable()
export class HotelsService {
  private readonly logger = new Logger(HotelsService.name);

  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<StoredHotel>,
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(RoomNight.name)
    private readonly roomNightModel: Model<RoomNight>,
    @Inject(RoomNightInventory) private readonly inventory: RoomNightInventory,
    @Inject(ReferenceDataService)
    private readonly referenceData: ReferenceDataService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  /** HTL-01: the HTTP controller must restrict creation to admins. */
  async create(input: CreateHotelDto): Promise<HotelView> {
    const fields = await this.profileFields(input);
    const hotel = await this.hotelModel.create(fields);
    return this.toView(hotel);
  }

  /** moderatorHotelId must come from the authenticated account, never the request body. */
  async update(
    hotelId: string,
    input: UpdateHotelDto,
    moderatorHotelId: string | undefined,
  ): Promise<HotelView> {
    const id = this.assignedHotelId(hotelId, moderatorHotelId);
    if (!(await this.hotelModel.exists({ _id: id }))) throw this.notFound();
    const fields = await this.profileFields(input);
    const hotel = await this.hotelModel
      .findOneAndUpdate(
        { _id: id },
        { $set: fields },
        { new: true, runValidators: true },
      )
      .lean()
      .exec();
    if (!hotel) throw this.notFound();
    return this.toView(hotel);
  }

  /** HTL-09 / HTL-10: replace the assigned hotel's policies; existing reservation snapshots are unchanged. */
  async updatePolicies(
    hotelId: string,
    input: UpdateHotelPoliciesDto,
    moderatorHotelId: string | undefined,
  ): Promise<HotelView> {
    const id = this.assignedHotelId(hotelId, moderatorHotelId);
    if (!(await this.hotelModel.exists({ _id: id }))) throw this.notFound();
    const hotel = await this.hotelModel
      .findOneAndUpdate(
        { _id: id },
        {
          $set: {
            checkInTime: input.checkInTime,
            checkOutTime: input.checkOutTime,
            cancellationPolicy: input.cancellationPolicy,
          },
        },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!hotel) throw this.notFound();
    return this.toView(hotel);
  }

  /** HTL-01 / GEN-08: atomic five-photo limit; a sixth image throws 400 LIMIT_EXCEEDED. */
  async addPhoto(
    hotelId: string,
    file: UploadedImage | undefined,
    moderatorHotelId: string | undefined,
  ): Promise<HotelView> {
    const id = this.assignedHotelId(hotelId, moderatorHotelId);
    if (!(await this.hotelModel.exists({ _id: id }))) throw this.notFound();
    if (!file) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'An image is required',
        details: [
          { field: 'file', message: 'must contain a JPG or PNG image' },
        ],
      });
    }
    const image = await this.storage.save(file);
    try {
      const hotel = await this.hotelModel
        .findOneAndUpdate(
          {
            _id: id,
            [`photos.${MAX_IMAGES_PER_ITEM - 1}`]: { $exists: false },
          },
          { $push: { photos: image } },
          { returnDocument: 'after', runValidators: true },
        )
        .lean()
        .exec();
      if (!hotel) {
        if (!(await this.hotelModel.exists({ _id: id }))) throw this.notFound();
        throw new BadRequestException({
          code: ErrorCode.LimitExceeded,
          message: 'A hotel can have at most five photos',
        });
      }
      return this.toView(hotel);
    } catch (error) {
      return this.discardUnattachedPhoto(id, image, error);
    }
  }

  /**
   * HTL-01 / GEN-08: keep the key until storage confirms deletion. If the database
   * removal then fails, retrying is safe because storage.delete is idempotent.
   */
  async removePhoto(
    hotelId: string,
    photoId: string,
    moderatorHotelId: string | undefined,
  ): Promise<void> {
    const id = this.assignedHotelId(hotelId, moderatorHotelId);
    const imageId = this.parseId(photoId, 'photoId');
    const hotel = await this.hotelModel.findById(id).lean().exec();
    const photo = hotel?.photos.find((item) => item._id.equals(imageId));
    if (!photo) throw this.notFound();
    await this.storage.delete(photo.key);
    const result = await this.hotelModel
      .updateOne(
        { _id: id, 'photos._id': imageId },
        { $pull: { photos: { _id: imageId } } },
        { runValidators: true },
      )
      .exec();
    if (!result.matchedCount) throw this.notFound();
  }

  /**
   * Includes inactive hotels; the caller checks bookability. Missing valid IDs return
   * null; malformed IDs throw 400 VALIDATION_FAILED.
   */
  async getHotel(
    hotelId: string,
    options?: HotelTransactionOptions,
  ): Promise<HotelView | null> {
    const hotel = await this.hotelModel
      .findById(this.parseId(hotelId), undefined, options)
      .lean()
      .exec();
    return hotel ? this.toView(hotel) : null;
  }

  /** HTL-02: public profile and stored rating summary; reviews are served by hotel-bookings. */
  async getHotelDetails(hotelId: string): Promise<HotelView> {
    const hotel = await this.getHotel(hotelId);
    if (!hotel) throw this.notFound();
    return hotel;
  }

  /** HTL-15: all free rooms, paginated by ID. Inactive hotels have no bookable rooms. Does not hold inventory. */
  async getAvailableRooms(
    hotelId: string,
    checkIn: Date,
    checkOut: Date,
    { page = 1, limit = 10 }: { page?: number; limit?: number } = {},
  ): Promise<Paginated<AvailableRoomView>> {
    assertStayDates(checkIn, checkOut);
    const details = [];
    for (const [field, value, max] of [
      ['page', page, Number.MAX_SAFE_INTEGER],
      ['limit', limit, 50],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1 || value > max)
        details.push({ field, message: `must be an integer from 1 to ${max}` });
    }
    if (details.length)
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid room pagination',
        details,
      });
    const hotel = await this.getHotelDetails(hotelId);
    if (!hotel.isActive) return toPage([], 0, page, limit);
    const free = await this.freeRooms(
      [this.parseId(hotelId)],
      checkIn,
      checkOut,
    );
    free.sort((a, b) => a._id.toHexString().localeCompare(b._id.toHexString()));
    const nights = daysBetween(checkIn, checkOut);
    const items = free.slice((page - 1) * limit, page * limit).map((room) => {
      const totalMinor = room.pricePerNightMinor * nights;
      if (!Number.isSafeInteger(totalMinor))
        throw new BadRequestException({
          code: ErrorCode.ValidationFailed,
          message: 'Stay price exceeds the supported integer range',
          details: [{ field: 'checkOut', message: 'stay total is too large' }],
        });
      return {
        id: room._id.toHexString(),
        hotelId: room.hotelId.toHexString(),
        name: room.name,
        type: room.type,
        beds: room.beds,
        maxOccupancy: room.maxOccupancy,
        pricePerNightMinor: room.pricePerNightMinor,
        totalMinor,
      };
    });
    return toPage(items, free.length, page, limit);
  }

  /**
   * HTL-03: assignment comes from the authenticated account. Names are stored
   * trimmed and lowercase; case-insensitive collisions include legacy names.
   * New rooms have no bookable dates.
   */
  async createRoom(
    hotelId: string,
    input: CreateRoomDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    const id = this.assignedHotelId(hotelId, moderatorHotelId);
    if (!(await this.hotelModel.exists({ _id: id }))) throw this.notFound();
    try {
      const room = new this.roomModel({
        hotelId: id,
        name: input.name.trim().toLowerCase(),
        type: input.type,
        beds: input.beds,
        maxOccupancy: input.maxOccupancy,
        pricePerNightMinor: input.pricePerNightMinor,
      });
      await room.validate();
      // Protect legacy mixed-case names; the existing unique index handles concurrent lowercase inserts.
      if (
        await this.roomModel.exists({
          hotelId: id,
          name: new RegExp(`^${escapeRegex(room.name)}$`, 'i'),
        })
      ) {
        throw this.roomNameConflict();
      }
      await room.save();
      return this.toRoomView(room);
    } catch (error) {
      if (error instanceof mongo.MongoServerError && error.code === 11000) {
        throw this.roomNameConflict();
      }
      throw error;
    }
  }

  /** HTL-05: only edits the assigned hotel's room fields; reservation price snapshots are never rewritten. */
  async updateRoom(
    hotelId: string,
    roomId: string,
    input: UpdateRoomDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    const room = await this.assignedRoom(hotelId, roomId, moderatorHotelId);
    const fields: UpdateRoomDto = {};
    if (input.beds !== undefined) fields.beds = input.beds;
    if (input.maxOccupancy !== undefined)
      fields.maxOccupancy = input.maxOccupancy;
    if (input.pricePerNightMinor !== undefined) {
      fields.pricePerNightMinor = input.pricePerNightMinor;
    }
    const updated = await this.roomModel
      .findOneAndUpdate(
        { _id: room._id, hotelId: room.hotelId },
        { $set: fields },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!updated) throw this.roomNotFound();
    return this.toRoomView(updated);
  }

  /** HTL-04: adds inclusive bookable nights; overlaps are invalid, adjacent ranges merge. */
  async addRoomAvailability(
    hotelId: string,
    roomId: string,
    input: RoomAvailabilityDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    return this.saveAvailability(
      hotelId,
      roomId,
      [parseAvailabilityRange(input)],
      moderatorHotelId,
      true,
    );
  }

  /** HTL-05: replaces all ranges; cannot exclude reservation nights from today onward, including holds. */
  async setRoomAvailability(
    hotelId: string,
    roomId: string,
    input: SetRoomAvailabilityDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    return this.saveAvailability(
      hotelId,
      roomId,
      input.ranges.map(parseAvailabilityRange),
      moderatorHotelId,
      false,
    );
  }

  /** HTL-03: paginated moderator list, including inactive rooms, in stable ID order. */
  async listRooms(
    hotelId: string,
    query: PaginationQueryDto,
    moderatorHotelId: string | undefined,
  ): Promise<Paginated<RoomView>> {
    const id = this.assignedHotelId(hotelId, moderatorHotelId);
    if (!(await this.hotelModel.exists({ _id: id }))) throw this.notFound();
    const result = await paginate(this.roomModel, { hotelId: id }, query, {
      sort: { _id: 1 },
    });
    return {
      ...result,
      items: result.items.map((room) => this.toRoomView(room)),
    };
  }

  /**
   * HTL-03: includes inactive rooms for booking validation. Missing valid hotel IDs
   * return []; malformed IDs throw 400 VALIDATION_FAILED. Reads use the caller's session.
   */
  async getRooms(
    hotelId: string,
    options?: HotelTransactionOptions,
  ): Promise<RoomView[]> {
    const rooms = await this.roomModel
      .find({ hotelId: this.parseId(hotelId) }, undefined, options)
      .sort({ _id: 1 })
      .lean()
      .exec();
    return rooms.map((room) => this.toRoomView(room));
  }

  /** HTL-06: BLOCK is inclusive; UNBLOCK requires a block belonging to this room (otherwise 404). */
  async manageRoomBlock(
    hotelId: string,
    roomId: string,
    input: RoomBlockOperationDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomBlockResponseDto> {
    const operation = parseRoomBlockOperation(input);
    return this.withAssignedRoom(
      hotelId,
      roomId,
      moderatorHotelId,
      async (room, options) => {
        if (operation.op === 'BLOCK') {
          const blockId = await this.inventory.block(
            room._id.toHexString(),
            operation.fromDate,
            operation.toDate,
            options,
          );
          return { blockId };
        }
        const block = await this.roomNightModel
          .exists({
            roomId: room._id,
            kind: RoomNightKind.BLOCKED,
            blockId: operation.blockId,
          })
          .session(options.session);
        if (!block) throw this.notFound();
        await this.inventory.unblock(operation.blockId, options);
        return { blockId: operation.blockId };
      },
    );
  }

  /** HTL-06: rejects today's/future reserved nights; retains the room and its history. */
  async deactivateRoom(
    hotelId: string,
    roomId: string,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    return this.withAssignedRoom(
      hotelId,
      roomId,
      moderatorHotelId,
      async (room, options) => {
        await this.inventory.deactivate(room._id.toHexString(), options);
        return { ...this.toRoomView(room), isActive: false };
      },
    );
  }

  /** HTL-06: only never-reserved rooms can be deleted; their blocks are removed atomically. */
  async deleteRoom(
    hotelId: string,
    roomId: string,
    moderatorHotelId: string | undefined,
  ): Promise<void> {
    await this.withAssignedRoom(
      hotelId,
      roomId,
      moderatorHotelId,
      (room, options) => this.inventory.delete(room._id.toHexString(), options),
    );
  }

  /**
   * HTL-08: the hotel's taken nights (reserved or blocked) from fromDate to toDate,
   * both inclusive, by date then room. Missing valid hotel IDs return [];
   * malformed IDs throw 400 VALIDATION_FAILED. Reads use the caller's session.
   */
  async getRoomNights(
    hotelId: string,
    fromDate: Date,
    toDate: Date,
    options?: HotelTransactionOptions,
  ): Promise<RoomNightView[]> {
    assertDateRange(fromDate, toDate);
    const nights = await this.roomNightModel
      .find(
        {
          hotelId: this.parseId(hotelId),
          date: { $gte: fromDate, $lte: toDate },
        },
        undefined,
        options,
      )
      .sort({ date: 1, roomId: 1 })
      .lean()
      .exec();
    return nights.map((night) => this.toRoomNightView(night));
  }

  /** HTL-11/12: reads inventory without holding it; reusable by ITN-25. */
  async search(query: HotelSearchQuery): Promise<Paginated<HotelSearchResult>> {
    assertStayDates(query.checkIn, query.checkOut);
    this.validateSearch(query);
    const { rooms = 1, page = 1, limit = 10 } = query;
    const hotels = await this.hotelModel
      .find({
        isActive: true,
        ...(query.cityId !== undefined ? { cityId: query.cityId } : {}),
        ...(query.countryCode !== undefined
          ? { countryCode: query.countryCode }
          : {}),
      })
      .select({ _id: 1, ratingSummary: 1 })
      .lean()
      .exec();
    if (!hotels.length) return toPage([], 0, page, limit);

    const hotelIds = hotels.map((hotel) => hotel._id);
    const candidates = await this.freeRooms(
      hotelIds,
      query.checkIn,
      query.checkOut,
      { hotelId: 1, maxOccupancy: 1, pricePerNightMinor: 1 },
    );
    const freeByHotel = new Map<string, typeof candidates>();
    for (const room of candidates) {
      const hotelId = room.hotelId.toHexString();
      const free = freeByHotel.get(hotelId) ?? [];
      free.push(room);
      freeByHotel.set(hotelId, free);
    }

    // Light records only: the full hotels are loaded for the requested page below.
    const matches: {
      id: string;
      pricePerNightMinor: number;
      average: number | null;
    }[] = [];
    for (const hotel of hotels) {
      const free = freeByHotel.get(hotel._id.toHexString()) ?? [];
      const pricePerNightMinor = cheapestQualifyingRoomPrice(
        free,
        query.guests,
        rooms,
      );
      if (pricePerNightMinor === null) continue;
      if (
        (query.minPriceMinor !== undefined &&
          pricePerNightMinor < query.minPriceMinor) ||
        (query.maxPriceMinor !== undefined &&
          pricePerNightMinor > query.maxPriceMinor) ||
        (query.minRating !== undefined &&
          (hotel.ratingSummary.average === null ||
            hotel.ratingSummary.average < query.minRating))
      )
        continue;
      matches.push({
        id: hotel._id.toHexString(),
        pricePerNightMinor,
        average: hotel.ratingSummary.average,
      });
    }

    const direction = query.sortOrder === 'desc' ? -1 : 1;
    matches.sort((a, b) => {
      if (query.sortBy) {
        const left =
          query.sortBy === 'price' ? a.pricePerNightMinor : a.average;
        const right =
          query.sortBy === 'price' ? b.pricePerNightMinor : b.average;
        if (left === null && right !== null) return 1;
        if (right === null && left !== null) return -1;
        if (left !== null && right !== null && left !== right)
          return (left - right) * direction;
      }
      return a.id.localeCompare(b.id);
    });
    const pageMatches = matches.slice((page - 1) * limit, page * limit);
    const pageHotels = await this.hotelModel
      .find({ _id: { $in: pageMatches.map((match) => match.id) } })
      .lean()
      .exec();
    const byId = new Map(
      pageHotels.map((hotel) => [hotel._id.toHexString(), hotel]),
    );
    const items: HotelSearchResult[] = [];
    for (const match of pageMatches) {
      const hotel = byId.get(match.id);
      if (hotel)
        items.push({
          ...this.toView(hotel),
          pricePerNightMinor: match.pricePerNightMinor,
        });
    }
    return toPage(items, matches.length, page, limit);
  }

  private async freeRooms(
    hotelIds: Types.ObjectId[],
    checkIn: Date,
    checkOut: Date,
    projection?: Record<string, 1>,
  ) {
    const [candidates, busyIds] = await Promise.all([
      this.roomModel
        .find({
          hotelId: { $in: hotelIds },
          isActive: true,
          availability: {
            $elemMatch: {
              fromDate: { $lte: checkIn },
              toDate: { $gte: addDays(checkOut, -1) },
            },
          },
        })
        .select(projection ?? {})
        .lean()
        .exec(),
      this.roomNightModel
        .distinct('roomId', {
          hotelId: { $in: hotelIds },
          date: { $gte: checkIn, $lt: checkOut },
        })
        .exec(),
    ]);
    const busy = new Set(busyIds.map((id) => id.toHexString()));
    return candidates.filter((room) => !busy.has(room._id.toHexString()));
  }

  private validateSearch(query: HotelSearchQuery): void {
    const details: { field: string; message: string }[] = [];
    if (!query.cityId && !query.countryCode) {
      details.push({
        field: 'cityId',
        message: 'supply cityId or countryCode',
      });
    }
    for (const [field, value] of [
      ['guests', query.guests],
      ['rooms', query.rooms ?? 1],
      ['page', query.page ?? 1],
      ['limit', query.limit ?? 10],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1)
        details.push({ field, message: 'must be a positive safe integer' });
    }
    if (query.limit !== undefined && query.limit > 50)
      details.push({ field: 'limit', message: 'must not exceed 50' });
    for (const [field, value] of [
      ['minPrice', query.minPriceMinor],
      ['maxPrice', query.maxPriceMinor],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
        details.push({ field, message: 'must be a non-negative safe integer' });
    }
    if (
      query.minPriceMinor !== undefined &&
      query.maxPriceMinor !== undefined &&
      query.minPriceMinor > query.maxPriceMinor
    )
      details.push({ field: 'maxPrice', message: 'must be at least minPrice' });
    if (
      query.minRating !== undefined &&
      !(query.minRating >= 1 && query.minRating <= 5)
    )
      details.push({ field: 'minRating', message: 'must be between 1 and 5' });
    if (details.length)
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid hotel search',
        details,
      });
  }

  /**
   * Writes the summary computed by hotel-bookings; schema/cast errors map to
   * 400 VALIDATION_FAILED. Missing valid hotel IDs throw NOT_FOUND.
   */
  async setRatingSummary(
    hotelId: string,
    summary: RatingSummary,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    const result = await this.hotelModel
      .updateOne(
        { _id: this.parseId(hotelId) },
        { $set: { ratingSummary: summary } },
        { runValidators: true, ...options },
      )
      .exec();
    if (!result.matchedCount) throw this.notFound();
  }

  /** ACC-15: existing reservations are not changed. Missing hotels throw NOT_FOUND. */
  async setActive(
    hotelId: string,
    isActive: boolean,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    const result = await this.hotelModel
      .updateOne(
        { _id: this.parseId(hotelId) },
        { $set: { isActive } },
        { runValidators: true, ...options },
      )
      .exec();
    if (!result.matchedCount) throw this.notFound();
  }

  private async assignedRoom(
    hotelId: string,
    roomId: string,
    moderatorHotelId: string | undefined,
    options?: HotelTransactionOptions,
  ) {
    const id = this.assignedHotelId(hotelId, moderatorHotelId);
    const roomObjectId = this.parseId(roomId, 'roomId');
    if (
      !(await this.hotelModel.exists({ _id: id }).setOptions(options ?? {}))
    ) {
      throw this.notFound();
    }
    const room = await this.roomModel
      .findOne({ _id: roomObjectId, hotelId: id }, undefined, options)
      .lean()
      .exec();
    if (!room) throw this.roomNotFound();
    return room;
  }

  private async saveAvailability(
    hotelId: string,
    roomId: string,
    ranges: RoomDateRange[],
    moderatorHotelId: string | undefined,
    append: boolean,
  ): Promise<RoomView> {
    const session = await this.roomModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const room = await this.assignedRoom(
          hotelId,
          roomId,
          moderatorHotelId,
          { session },
        );
        const view = this.toRoomView(room);
        await this.inventory.setAvailability(
          view.id,
          append ? [...view.availability, ...ranges] : ranges,
          { session },
        );
        const updated = await this.roomModel
          .findOne({ _id: room._id, hotelId: room.hotelId }, undefined, {
            session,
          })
          .lean()
          .exec();
        if (!updated) throw this.roomNotFound();
        return this.toRoomView(updated);
      });
    } finally {
      await session.endSession();
    }
  }

  private roomNotFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Room not found',
    });
  }

  private async profileFields(
    input: UpdateHotelDto,
  ): Promise<Partial<ProfileFields>> {
    const fields: Partial<ProfileFields> = {};
    if (input.name !== undefined) fields.name = input.name.trim();
    if (input.address !== undefined) fields.address = input.address.trim();
    if (input.description !== undefined) fields.description = input.description;
    if (input.starRating !== undefined) fields.starRating = input.starRating;
    if (input.amenities !== undefined) {
      fields.amenities = input.amenities.map((amenity) => amenity.trim());
    }
    if (input.cityId !== undefined) {
      const city = await this.referenceData.getCity(input.cityId);
      if (!city) {
        throw new BadRequestException({
          code: ErrorCode.ValidationFailed,
          message: 'Unknown city',
          details: [
            {
              field: 'cityId',
              message: 'must be an existing reference-data city',
            },
          ],
        });
      }
      fields.cityId = city.id;
      fields.countryCode = city.countryCode;
    }
    return fields;
  }

  private async withAssignedRoom<T>(
    hotelId: string,
    roomId: string,
    moderatorHotelId: string | undefined,
    work: (
      room: Room & { _id: Types.ObjectId },
      options: HotelTransactionOptions,
    ) => Promise<T>,
  ): Promise<T> {
    const id = this.assignedHotelId(hotelId, moderatorHotelId);
    const target = this.parseId(roomId, 'roomId');
    const session = await this.roomModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        if (!(await this.hotelModel.exists({ _id: id }).session(session))) {
          throw this.notFound();
        }
        const room = await this.roomModel
          .findOne({ _id: target, hotelId: id })
          .session(session)
          .lean();
        if (!room) throw this.notFound();
        return work(room, { session });
      });
    } finally {
      await session.endSession();
    }
  }

  private assignedHotelId(
    hotelId: string,
    moderatorHotelId: string | undefined,
  ): Types.ObjectId {
    const id = this.parseId(hotelId);
    if (
      !moderatorHotelId ||
      !Types.ObjectId.isValid(moderatorHotelId) ||
      !id.equals(moderatorHotelId)
    ) {
      throw this.notFound();
    }
    return id;
  }

  private async discardUnattachedPhoto(
    hotelId: Types.ObjectId,
    image: StoredImage,
    failure: unknown,
  ): Promise<never> {
    try {
      // A rejected database reply does not prove the write was rejected.
      const attached = await this.hotelModel.exists({
        _id: hotelId,
        photos: { $elemMatch: { _id: image._id, key: image.key } },
      });
      if (!attached) await this.storage.delete(image.key);
    } catch (cleanupError) {
      this.logger.error(
        `Could not reconcile hotel ${hotelId.toHexString()} photo ${image._id.toHexString()} (key ${image.key})`,
      );
      throw new AggregateError(
        [failure, cleanupError],
        'Hotel photo cleanup failed',
      );
    }
    throw failure;
  }

  private toRoomNightView(night: RoomNight): RoomNightView {
    const base = {
      roomId: night.roomId.toHexString(),
      hotelId: night.hotelId.toHexString(),
      date: night.date,
    };
    if (night.kind === RoomNightKind.RESERVATION && night.reservationId) {
      return {
        ...base,
        kind: 'reservation',
        reservationId: night.reservationId.toHexString(),
      };
    }
    if (night.kind === RoomNightKind.BLOCKED && night.blockId) {
      return { ...base, kind: 'blocked', blockId: night.blockId.toHexString() };
    }
    throw new InternalServerErrorException({
      code: ErrorCode.InventoryCorrupted,
      message: 'Room night has no reservation or block',
    });
  }

  private parseId(value: string, field = 'hotelId'): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid ID',
        details: [{ field, message: 'must be an ObjectId' }],
      });
    }
    return new Types.ObjectId(value);
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Hotel not found',
    });
  }

  private roomNameConflict(): ConflictException {
    return new ConflictException({
      code: ErrorCode.Conflict,
      message: 'A room with this name already exists in this hotel',
    });
  }

  private toRoomView(room: Room & { _id: Types.ObjectId }): RoomView {
    return {
      id: room._id.toHexString(),
      hotelId: room.hotelId.toHexString(),
      name: room.name,
      type: room.type,
      beds: room.beds,
      maxOccupancy: room.maxOccupancy,
      pricePerNightMinor: room.pricePerNightMinor,
      isActive: room.isActive,
      availability: room.availability.map(({ fromDate, toDate }) => ({
        fromDate,
        toDate,
      })),
      hasEverBeenReserved: room.hasEverBeenReserved,
    };
  }

  private toView(hotel: HotelRecord): HotelView {
    return {
      id: hotel._id.toHexString(),
      name: hotel.name,
      address: hotel.address,
      cityId: hotel.cityId,
      countryCode: hotel.countryCode,
      ...(hotel.description !== undefined
        ? { description: hotel.description }
        : {}),
      ...(hotel.starRating !== undefined
        ? { starRating: hotel.starRating }
        : {}),
      photos: hotel.photos.map((photo) => ({
        id: photo._id.toHexString(),
        key: photo.key,
      })),
      amenities: [...hotel.amenities],
      checkInTime: hotel.checkInTime,
      checkOutTime: hotel.checkOutTime,
      cancellationPolicy: {
        tiers: hotel.cancellationPolicy.tiers.map((tier) => ({
          daysBefore: tier.daysBefore,
          refundPercent: tier.refundPercent,
        })),
      },
      isActive: hotel.isActive,
      ratingSummary: {
        average: hotel.ratingSummary.average,
        count: hotel.ratingSummary.count,
      },
    };
  }
}
