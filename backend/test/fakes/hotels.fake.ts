import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { addDays, isDateOnly } from '../../src/common/dates/date-only.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import type { HotelsService } from '../../src/modules/hotels/hotels.service.js';
import type { CreateHotelDto } from '../../src/modules/hotels/dto/create-hotel.dto.js';
import type { UpdateHotelDto } from '../../src/modules/hotels/dto/update-hotel.dto.js';
import type { ReferenceDataService } from '../../src/modules/reference-data/reference-data.service.js';
import type {
  HotelSearchQuery,
  HotelSearchResult,
  HotelTransactionOptions,
  HotelView,
  RoomNightView,
  RoomView,
} from '../../src/modules/hotels/hotels.types.js';
import type { RatingSummary } from '../../src/modules/hotels/schemas/hotel.schema.js';
import type { PublicApi } from './public-api.js';
import { FakeReferenceDataService } from './reference-data.fake.js';

export interface HotelDataset {
  hotels: HotelView[];
  rooms: RoomView[];
  roomNights: RoomNightView[];
}

export function assertDateRange(fromDate: Date, toDate: Date): void {
  if (!isDateOnly(fromDate) || !isDateOnly(toDate) || toDate < fromDate) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Dates must be UTC calendar dates in ascending order',
    });
  }
}

export function assertStayDates(checkIn: Date, checkOut: Date): void {
  assertDateRange(checkIn, checkOut);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (checkOut <= checkIn || checkIn < today) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Check-in cannot be in the past; check-out must follow check-in',
    });
  }
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
    this.data.hotels.push(hotel);
    return structuredClone(hotel);
  }

  async update(
    hotelId: string,
    input: UpdateHotelDto,
    moderatorHotelId: string | undefined,
  ): Promise<HotelView> {
    if (hotelId !== moderatorHotelId) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Hotel not found',
      });
    }
    const hotel = this.requireHotel(hotelId);
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
    Object.assign(hotel, fields);
    return structuredClone(hotel);
  }

  getHotel(
    hotelId: string,
    options?: HotelTransactionOptions,
  ): Promise<HotelView | null> {
    void options;
    return Promise.resolve(
      structuredClone(
        this.data.hotels.find((hotel) => hotel.id === hotelId) ?? null,
      ),
    );
  }

  getRooms(
    hotelId: string,
    options?: HotelTransactionOptions,
  ): Promise<RoomView[]> {
    void options;
    return Promise.resolve(
      structuredClone(
        this.data.rooms.filter((room) => room.hotelId === hotelId),
      ),
    );
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
      const capacity = freeRooms
        .map((room) => room.maxOccupancy)
        .sort((a, b) => b - a)
        .slice(0, rooms)
        .reduce((sum, occupancy) => sum + occupancy, 0);
      if (freeRooms.length < rooms || capacity < guests) continue;
      const pricePerNightMinor = Math.min(
        ...freeRooms.map((room) => room.pricePerNightMinor),
      );
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
    this.requireHotel(hotelId).ratingSummary = structuredClone(summary);
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
    const hotel = this.data.hotels.find((item) => item.id === hotelId);
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
}
