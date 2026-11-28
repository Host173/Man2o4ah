import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Error as MongooseError, Mongoose, Types } from 'mongoose';
import { addDays, daysBetween } from '../../src/common/dates/date-only.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import type { PaginationQueryDto } from '../../src/common/pagination/pagination-query.dto.js';
import {
  escapeRegex,
  keywordRegex,
} from '../../src/common/text/escape-regex.js';
import type { HotelsService } from '../../src/modules/hotels/hotels.service.js';
import type { CreateHotelDto } from '../../src/modules/hotels/dto/create-hotel.dto.js';
import type { CreateRoomDto } from '../../src/modules/hotels/dto/create-room.dto.js';
import type {
  RoomBlockOperationDto,
  RoomBlockResponseDto,
} from '../../src/modules/hotels/dto/room-block-operation.dto.js';
import { parseRoomBlockOperation } from '../../src/modules/hotels/room-block-operation.js';
import type {
  RoomAvailabilityDto,
  SetRoomAvailabilityDto,
} from '../../src/modules/hotels/dto/room-availability.dto.js';
import type { UpdateRoomDto } from '../../src/modules/hotels/dto/update-room.dto.js';
import type { UpdateHotelPoliciesDto } from '../../src/modules/hotels/dto/update-hotel-policies.dto.js';
import type { UpdateHotelDto } from '../../src/modules/hotels/dto/update-hotel.dto.js';
import type { ReferenceDataService } from '../../src/modules/reference-data/reference-data.service.js';
import type {
  AvailableRoomView,
  HotelListItem,
  HotelListQuery,
  HotelListResult,
  HotelSearchQuery,
  HotelSearchResult,
  HotelTransactionOptions,
  HotelView,
  RoomNightView,
  RoomView,
} from '../../src/modules/hotels/hotels.types.js';
import {
  Hotel,
  HotelSchema,
} from '../../src/modules/hotels/schemas/hotel.schema.js';
import type { RatingSummary } from '../../src/modules/hotels/schemas/hotel.schema.js';
import {
  Room,
  RoomSchema,
} from '../../src/modules/hotels/schemas/room.schema.js';
import { MAX_IMAGES_PER_ITEM } from '../../src/modules/storage/image-rules.js';
import type { UploadedImage } from '../../src/modules/storage/image-rules.js';
import type { StorageService } from '../../src/modules/storage/storage.service.js';
import type { PublicApi } from './public-api.js';
import {
  assertDateRange,
  assertStayDates,
  parseAvailabilityRange,
} from '../../src/modules/hotels/room-date-ranges.js';
import { FakeRoomNightInventory } from './room-night-inventory.fake.js';
import { FakeReferenceDataService } from './reference-data.fake.js';
import { FakeStorageService } from './storage.fake.js';
import { cheapestQualifyingRoomPrice } from '../../src/modules/hotels/hotel-search-pricing.js';

// Disconnected: share production validators without opening a database connection.
const HotelValidationModel = new Mongoose().model(Hotel.name, HotelSchema);
const RoomValidationModel = new Mongoose().model(Room.name, RoomSchema);

export interface HotelDataset {
  hotels: HotelView[];
  rooms: RoomView[];
  roomNights: RoomNightView[];
}

/** Shared with FakeRoomNightInventory; sessions are accepted but not simulated. */
export class FakeHotelsService implements PublicApi<HotelsService> {
  readonly data: HotelDataset;

  constructor(
    dataset: Partial<HotelDataset> = {},
    private readonly referenceData: Pick<
      ReferenceDataService,
      'getCity'
    > = new FakeReferenceDataService(),
    private readonly storage: Pick<
      StorageService,
      'save' | 'delete'
    > = new FakeStorageService(),
  ) {
    this.data = structuredClone({
      hotels: [],
      rooms: [],
      roomNights: [],
      ...dataset,
    });
  }

  async create(input: CreateHotelDto): Promise<HotelView> {
    const city = await this.requireCity(input.cityId);
    const hotel: HotelView = {
      id: new Types.ObjectId().toHexString(),
      name: input.name.trim(),
      address: input.address.trim(),
      cityId: city.id,
      countryCode: city.countryCode,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.starRating !== undefined
        ? { starRating: input.starRating }
        : {}),
      photos: [],
      amenities: input.amenities?.map((amenity) => amenity.trim()) ?? [],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationPolicy: { tiers: [] },
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    };
    await this.validate(hotel);
    this.data.hotels.push(hotel);
    return structuredClone(hotel);
  }

  async update(
    hotelId: string,
    input: UpdateHotelDto,
    moderatorHotelId: string | undefined,
  ): Promise<HotelView> {
    const hotel = this.assignedHotel(hotelId, moderatorHotelId);
    const fields: Partial<HotelView> = {};
    if (input.cityId !== undefined) {
      const city = await this.requireCity(input.cityId);
      fields.cityId = city.id;
      fields.countryCode = city.countryCode;
    }
    if (input.name !== undefined) fields.name = input.name.trim();
    if (input.address !== undefined) fields.address = input.address.trim();
    if (input.description !== undefined) fields.description = input.description;
    if (input.starRating !== undefined) fields.starRating = input.starRating;
    if (input.amenities !== undefined) {
      fields.amenities = input.amenities.map((amenity) => amenity.trim());
    }
    await this.validate(fields, Object.keys(fields));
    Object.assign(hotel, fields);
    return structuredClone(hotel);
  }

  async updatePolicies(
    hotelId: string,
    input: UpdateHotelPoliciesDto,
    moderatorHotelId: string | undefined,
  ): Promise<HotelView> {
    const hotel = this.assignedHotel(hotelId, moderatorHotelId);
    const fields = {
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      cancellationPolicy: structuredClone(input.cancellationPolicy),
    };
    await this.validate(fields, Object.keys(fields));
    Object.assign(hotel, fields);
    return structuredClone(hotel);
  }

  async addPhoto(
    hotelId: string,
    file: UploadedImage | undefined,
    moderatorHotelId: string | undefined,
  ): Promise<HotelView> {
    const hotel = this.assignedHotel(hotelId, moderatorHotelId);
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
    if (hotel.photos.length >= MAX_IMAGES_PER_ITEM) {
      const failure = new BadRequestException({
        code: ErrorCode.LimitExceeded,
        message: 'A hotel can have at most five photos',
      });
      try {
        await this.storage.delete(image.key);
      } catch (cleanupError) {
        throw new AggregateError(
          [failure, cleanupError],
          'Hotel photo cleanup failed',
        );
      }
      throw failure;
    }
    hotel.photos.push({ id: image._id.toHexString(), key: image.key });
    return structuredClone(hotel);
  }

  async removePhoto(
    hotelId: string,
    photoId: string,
    moderatorHotelId: string | undefined,
  ): Promise<void> {
    const hotel = this.assignedHotel(hotelId, moderatorHotelId);
    const imageId = this.parseId(photoId, 'photoId');
    const photo = hotel.photos.find((item) => item.id === imageId);
    if (!photo) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Hotel not found',
      });
    }
    await this.storage.delete(photo.key);
    const index = hotel.photos.findIndex((item) => item.id === imageId);
    if (index === -1) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Hotel not found',
      });
    }
    hotel.photos.splice(index, 1);
  }

  /** Malformed IDs throw 400 VALIDATION_FAILED; missing valid IDs return null. */
  async getHotel(
    hotelId: string,
    options?: HotelTransactionOptions,
  ): Promise<HotelView | null> {
    void options;
    const id = this.parseId(hotelId);
    return structuredClone(
      this.data.hotels.find((hotel) => hotel.id === id) ?? null,
    );
  }

  async getHotelDetails(hotelId: string): Promise<HotelView> {
    return structuredClone(this.requireHotel(hotelId));
  }

  async listHotels(query: HotelListQuery): Promise<HotelListResult> {
    const trimmed = query.q?.trim();
    const pattern = trimmed ? keywordRegex(trimmed) : undefined;
    const matches = this.data.hotels
      .filter((hotel) => {
        if (query.status === 'active' && !hotel.isActive) return false;
        if (query.status === 'inactive' && hotel.isActive) return false;
        if (pattern && !pattern.test(hotel.name)) return false;
        return true;
      })
      .sort((a, b) =>
        a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : a.id < b.id
              ? -1
              : a.id > b.id
                ? 1
                : 0,
      );

    const total = matches.length;
    if (query.limit <= 0) return { items: [], total };

    const items: HotelListItem[] = matches
      .slice(query.skip, query.skip + query.limit)
      .map((hotel) => ({
        id: hotel.id,
        name: hotel.name,
        cityId: hotel.cityId,
        countryCode: hotel.countryCode,
        isActive: hotel.isActive,
      }));
    return { items, total };
  }

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
    const hotel = this.requireHotel(hotelId);
    if (!hotel.isActive) return toPage([], 0, page, limit);
    const free = this.availableRooms(hotel.id, checkIn, checkOut).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
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
        id: room.id,
        hotelId: room.hotelId,
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

  async createRoom(
    hotelId: string,
    input: CreateRoomDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    const hotel = this.assignedHotel(hotelId, moderatorHotelId);
    const document = new RoomValidationModel({
      hotelId: hotel.id,
      name: input.name.trim().toLowerCase(),
      type: input.type,
      beds: input.beds,
      maxOccupancy: input.maxOccupancy,
      pricePerNightMinor: input.pricePerNightMinor,
    });
    await document.validate();
    const sameName = new RegExp(`^${escapeRegex(document.name)}$`, 'i');
    if (
      this.data.rooms.some(
        (room) => room.hotelId === hotel.id && sameName.test(room.name),
      )
    ) {
      throw new ConflictException({
        code: ErrorCode.Conflict,
        message: 'A room with this name already exists in this hotel',
      });
    }
    const room: RoomView = {
      id: document._id.toHexString(),
      hotelId: hotel.id,
      name: document.name,
      type: document.type,
      beds: document.beds,
      maxOccupancy: document.maxOccupancy,
      pricePerNightMinor: document.pricePerNightMinor,
      isActive: document.isActive,
      availability: [],
      hasEverBeenReserved: document.hasEverBeenReserved,
    };
    this.data.rooms.push(room);
    return structuredClone(room);
  }

  async updateRoom(
    hotelId: string,
    roomId: string,
    input: UpdateRoomDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    const room = this.assignedRoom(hotelId, roomId, moderatorHotelId);
    const fields: UpdateRoomDto = {};
    if (input.beds !== undefined) fields.beds = input.beds;
    if (input.maxOccupancy !== undefined)
      fields.maxOccupancy = input.maxOccupancy;
    if (input.pricePerNightMinor !== undefined)
      fields.pricePerNightMinor = input.pricePerNightMinor;
    const document = new RoomValidationModel(room);
    document.set(fields);
    await document.validate(Object.keys(fields));
    Object.assign(room, fields);
    return structuredClone(room);
  }

  async addRoomAvailability(
    hotelId: string,
    roomId: string,
    input: RoomAvailabilityDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    const range = parseAvailabilityRange(input);
    const room = this.assignedRoom(hotelId, roomId, moderatorHotelId);
    await new FakeRoomNightInventory(this).setAvailability(room.id, [
      ...room.availability,
      range,
    ]);
    return structuredClone(room);
  }

  async setRoomAvailability(
    hotelId: string,
    roomId: string,
    input: SetRoomAvailabilityDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    const ranges = input.ranges.map(parseAvailabilityRange);
    const room = this.assignedRoom(hotelId, roomId, moderatorHotelId);
    await new FakeRoomNightInventory(this).setAvailability(room.id, ranges);
    return structuredClone(room);
  }

  private assignedRoom(
    hotelId: string,
    roomId: string,
    moderatorHotelId: string | undefined,
  ): RoomView {
    const hotel = this.assignedHotel(hotelId, moderatorHotelId);
    const id = this.parseId(roomId, 'roomId');
    const room = this.data.rooms.find(
      (item) => item.id === id && item.hotelId === hotel.id,
    );
    if (!room) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Room not found',
      });
    }
    return room;
  }

  async listRooms(
    hotelId: string,
    { page, limit }: PaginationQueryDto,
    moderatorHotelId: string | undefined,
  ): Promise<Paginated<RoomView>> {
    const hotel = this.assignedHotel(hotelId, moderatorHotelId);
    const rooms = await this.getRooms(hotel.id);
    return toPage(
      rooms.slice((page - 1) * limit, page * limit),
      rooms.length,
      page,
      limit,
    );
  }

  async getRooms(
    hotelId: string,
    options?: HotelTransactionOptions,
  ): Promise<RoomView[]> {
    void options;
    const id = this.parseId(hotelId);
    return structuredClone(
      this.data.rooms
        .filter((room) => room.hotelId === id)
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  async manageRoomBlock(
    hotelId: string,
    roomId: string,
    input: RoomBlockOperationDto,
    moderatorHotelId: string | undefined,
  ): Promise<RoomBlockResponseDto> {
    const operation = parseRoomBlockOperation(input);
    const room = this.assignedRoom(hotelId, roomId, moderatorHotelId);
    const inventory = new FakeRoomNightInventory(this);
    if (operation.op === 'BLOCK') {
      return {
        blockId: await inventory.block(
          room.id,
          operation.fromDate,
          operation.toDate,
        ),
      };
    }
    if (
      !this.data.roomNights.some(
        (night) =>
          night.roomId === room.id &&
          night.kind === 'blocked' &&
          night.blockId === operation.blockId,
      )
    ) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Block not found',
      });
    }
    await inventory.unblock(operation.blockId);
    return { blockId: operation.blockId };
  }

  async deactivateRoom(
    hotelId: string,
    roomId: string,
    moderatorHotelId: string | undefined,
  ): Promise<RoomView> {
    const room = this.assignedRoom(hotelId, roomId, moderatorHotelId);
    await new FakeRoomNightInventory(this).deactivate(room.id);
    return structuredClone(room);
  }

  async deleteRoom(
    hotelId: string,
    roomId: string,
    moderatorHotelId: string | undefined,
  ): Promise<void> {
    const room = this.assignedRoom(hotelId, roomId, moderatorHotelId);
    await new FakeRoomNightInventory(this).delete(room.id);
  }

  async getRoomNights(
    hotelId: string,
    fromDate: Date,
    toDate: Date,
    options?: HotelTransactionOptions,
  ): Promise<RoomNightView[]> {
    void options;
    assertDateRange(fromDate, toDate);
    return structuredClone(
      this.data.roomNights.filter(
        (night) =>
          night.hotelId === hotelId &&
          night.date >= fromDate &&
          night.date <= toDate,
      ),
    );
  }

  availableRooms(hotelId: string, checkIn: Date, checkOut: Date): RoomView[] {
    const lastNight = addDays(checkOut, -1);
    return this.data.rooms.filter(
      (room) =>
        room.hotelId === hotelId &&
        room.isActive &&
        room.availability.some(
          (range) => range.fromDate <= checkIn && range.toDate >= lastNight,
        ) &&
        !this.data.roomNights.some(
          (night) =>
            night.roomId === room.id &&
            night.date >= checkIn &&
            night.date < checkOut,
        ),
    );
  }

  async search(query: HotelSearchQuery): Promise<Paginated<HotelSearchResult>> {
    assertStayDates(query.checkIn, query.checkOut);
    const { guests, rooms = 1, page = 1, limit = 10 } = query;
    if (
      (!query.cityId && !query.countryCode) ||
      ![guests, rooms, page, limit].every(
        (value) => Number.isInteger(value) && value > 0,
      ) ||
      limit > 50 ||
      (query.minPriceMinor !== undefined &&
        (!Number.isInteger(query.minPriceMinor) || query.minPriceMinor < 0)) ||
      (query.maxPriceMinor !== undefined &&
        (!Number.isInteger(query.maxPriceMinor) || query.maxPriceMinor < 0)) ||
      (query.minPriceMinor !== undefined &&
        query.maxPriceMinor !== undefined &&
        query.minPriceMinor > query.maxPriceMinor) ||
      (query.minRating !== undefined &&
        !(query.minRating >= 1 && query.minRating <= 5))
    ) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid hotel search',
      });
    }

    const matches: HotelSearchResult[] = [];
    for (const hotel of this.data.hotels) {
      if (
        !hotel.isActive ||
        (query.cityId && hotel.cityId !== query.cityId) ||
        (query.countryCode && hotel.countryCode !== query.countryCode)
      )
        continue;
      const freeRooms = this.availableRooms(
        hotel.id,
        query.checkIn,
        query.checkOut,
      );
      const pricePerNightMinor = cheapestQualifyingRoomPrice(
        freeRooms,
        guests,
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
      matches.push({ ...hotel, pricePerNightMinor });
    }

    if (query.sortBy) {
      const sortBy = query.sortBy;
      const direction = query.sortOrder === 'desc' ? -1 : 1;
      matches.sort((a, b) => {
        const left =
          sortBy === 'price' ? a.pricePerNightMinor : a.ratingSummary.average;
        const right =
          sortBy === 'price' ? b.pricePerNightMinor : b.ratingSummary.average;
        if (left === null) return right === null ? 0 : 1;
        if (right === null) return -1;
        return (left - right) * direction;
      });
    }
    return toPage(
      structuredClone(matches.slice((page - 1) * limit, page * limit)),
      matches.length,
      page,
      limit,
    );
  }

  async setRatingSummary(
    hotelId: string,
    summary: RatingSummary,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void options;
    const id = this.parseId(hotelId);
    await this.validate({ ratingSummary: summary }, ['ratingSummary']);
    this.requireHotel(id).ratingSummary = structuredClone(summary);
  }

  async setActive(
    hotelId: string,
    isActive: boolean,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void options;
    this.requireHotel(hotelId).isActive = isActive;
  }

  private requireHotel(hotelId: string): HotelView {
    const id = this.parseId(hotelId);
    const hotel = this.data.hotels.find((item) => item.id === id);
    if (!hotel) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Hotel not found',
      });
    }
    return hotel;
  }

  private async requireCity(cityId: string) {
    const city = await this.referenceData.getCity(cityId);
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
    return city;
  }

  private assignedHotel(
    hotelId: string,
    moderatorHotelId: string | undefined,
  ): HotelView {
    const hotel = this.requireHotel(hotelId);
    if (
      !moderatorHotelId ||
      !Types.ObjectId.isValid(moderatorHotelId) ||
      hotel.id !== new Types.ObjectId(moderatorHotelId).toHexString()
    ) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Hotel not found',
      });
    }
    return hotel;
  }

  private parseId(value: string, field = 'hotelId'): string {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid ID',
        details: [{ field, message: 'must be an ObjectId' }],
      });
    }
    return new Types.ObjectId(value).toHexString();
  }

  private async validate(
    fields: Partial<HotelView>,
    paths?: string[],
  ): Promise<void> {
    try {
      await new HotelValidationModel(fields).validate(paths);
    } catch (error) {
      if (paths && error instanceof MongooseError.ValidationError) {
        // Mongoose updates throw cast errors directly, unlike document creation.
        for (const fieldError of Object.values(error.errors)) {
          if (fieldError instanceof MongooseError.CastError) throw fieldError;
        }
      }
      throw error;
    }
  }
}
