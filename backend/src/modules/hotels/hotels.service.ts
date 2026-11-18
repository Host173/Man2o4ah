import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { mongo, Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
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
import type { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto.js';
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
import { Room } from './schemas/room.schema.js';

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
