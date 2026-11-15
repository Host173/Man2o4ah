import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import type { CreateHotelDto } from './dto/create-hotel.dto.js';
import type { UpdateHotelDto } from './dto/update-hotel.dto.js';
import type {
  HotelSearchQuery,
  HotelSearchResult,
  HotelTransactionOptions,
  HotelView,
  RoomNightView,
  RoomView,
} from './hotels.types.js';
import { Hotel } from './schemas/hotel.schema.js';
import type { RatingSummary } from './schemas/hotel.schema.js';

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
  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<StoredHotel>,
    @Inject(ReferenceDataService)
    private readonly referenceData: ReferenceDataService,
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
    moderatorHotelId: string,
  ): Promise<HotelView> {
    const id = this.parseId(hotelId);
    if (
      !Types.ObjectId.isValid(moderatorHotelId) ||
      !id.equals(moderatorHotelId)
    ) {
      throw this.notFound();
    }
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

  /** Includes inactive hotels; the caller checks bookability. Missing IDs return null. */
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

  /** Includes inactive rooms for booking validation and moderator views. */
  getRooms(
    hotelId: string,
    options?: HotelTransactionOptions,
  ): Promise<RoomView[]> {
    void hotelId;
    void options;
    throw new NotImplementedException('getRooms: implemented in HTL-03');
  }

  /** Taken nights in the inclusive date range, for HTL-08's room status view. */
  getRoomNights(
    hotelId: string,
    fromDate: Date,
    toDate: Date,
    options?: HotelTransactionOptions,
  ): Promise<RoomNightView[]> {
    void hotelId;
    void fromDate;
    void toDate;
    void options;
    throw new NotImplementedException('getRoomNights: implemented in INV-02');
  }

  search(query: HotelSearchQuery): Promise<Paginated<HotelSearchResult>> {
    void query;
    throw new NotImplementedException('search: implemented in HTL-11');
  }

  /** Writes the summary computed by hotel-bookings; missing hotels throw NOT_FOUND. */
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

  private parseId(hotelId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(hotelId)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid hotel ID',
        details: [{ field: 'hotelId', message: 'must be an ObjectId' }],
      });
    }
    return new Types.ObjectId(hotelId);
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Hotel not found',
    });
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
