import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { mongo, Types } from 'mongoose';
import type {
  ClientSession,
  Connection,
  Model,
  QueryFilter,
  UpdateQuery,
} from 'mongoose';
import type { Paginated } from '../../common/pagination/paginated.js';
import { paginate } from '../../common/pagination/paginate.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { HotelsService } from '../hotels/hotels.service.js';
import type {
  CreateHotelReviewInput,
  HotelReviewListItemView,
  HotelReviewView,
  ListHotelReviewsQuery,
  UpdateHotelReviewInput,
} from './hotel-bookings.types.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';
import { Review } from './schemas/review.schema.js';
import { toHotelRatingSummary } from './hotel-review-rating.js';

type StoredReview = Review & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type ReviewReservation = Pick<HotelReservation, 'hotelId' | 'status'>;

interface RatingAggregate {
  average: number | null;
  count: number;
}

function isDuplicateReservationReview(error: unknown): boolean {
  return (
    error instanceof mongo.MongoServerError &&
    error.code === 11000 &&
    error.keyPattern?.reservationId === 1
  );
}

@Injectable()
export class HotelReviewsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Review.name)
    private readonly reviewModel: Model<StoredReview>,
    @InjectModel(HotelReservation.name)
    private readonly reservationModel: Model<HotelReservation>,
    private readonly hotels: HotelsService,
    private readonly accounts: AccountsService,
  ) {}

  async create(
    reservationId: string,
    userId: string,
    input: CreateHotelReviewInput,
  ): Promise<HotelReviewView> {
    const reservationObjectId = this.parseId(reservationId, 'id');
    const userObjectId = this.parseId(userId, 'userId');
    let result: HotelReviewView | undefined;

    try {
      await this.inTransaction(async (session) => {
        const reservation = await this.reservationModel
          .findOne({
            _id: reservationObjectId,
            userId: userObjectId,
          })
          .session(session)
          .lean<ReviewReservation>();
        if (!reservation) throw this.notFound();
        if (reservation.status !== HotelReservationStatus.COMPLETED) {
          throw new ConflictException({
            code: ErrorCode.InvalidStatusTransition,
            message:
              'A review can only be submitted for a completed reservation',
          });
        }

        const [review] = await this.reviewModel.create(
          [
            {
              reservationId: reservationObjectId,
              hotelId: reservation.hotelId,
              userId: userObjectId,
              rating: input.rating,
              ...(input.text !== undefined ? { text: input.text } : {}),
              isHidden: false,
            },
          ],
          { session },
        );
        if (!review) {
          throw new InternalServerErrorException({
            code: ErrorCode.InternalError,
            message: 'Review creation returned no document',
          });
        }

        await this.recomputeRatingSummary(
          reservation.hotelId.toHexString(),
          session,
        );
        result = this.toView(review);
      });
    } catch (error) {
      if (isDuplicateReservationReview(error)) {
        throw new ConflictException({
          code: ErrorCode.AlreadyReviewed,
          message: 'This reservation already has a review',
        });
      }
      throw error;
    }

    if (!result) {
      throw new InternalServerErrorException({
        code: ErrorCode.InternalError,
        message: 'Review transaction completed without a result',
      });
    }
    return result;
  }

  async update(
    reviewId: string,
    userId: string,
    input: UpdateHotelReviewInput,
  ): Promise<HotelReviewView> {
    if (input.rating === undefined && input.text === undefined) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'At least one review field must be provided',
        details: [
          { field: 'review', message: 'provide rating or text to update' },
        ],
      });
    }

    const reviewObjectId = this.parseId(reviewId, 'id');
    const userObjectId = this.parseId(userId, 'userId');
    let result: HotelReviewView | undefined;

    await this.inTransaction(async (session) => {
      const current = await this.reviewModel
        .findOne({ _id: reviewObjectId, userId: userObjectId })
        .session(session)
        .lean<StoredReview>();
      if (!current) throw this.notFound();

      const update: UpdateQuery<StoredReview> = {};
      if (input.rating !== undefined) {
        update.$set = { ...update.$set, rating: input.rating };
      }
      if (input.text === null) {
        update.$unset = { ...update.$unset, text: 1 };
      } else if (input.text !== undefined) {
        update.$set = { ...update.$set, text: input.text };
      }

      const updated = await this.reviewModel
        .findOneAndUpdate(
          { _id: reviewObjectId, userId: userObjectId },
          update,
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<StoredReview>();
      if (!updated) throw this.notFound();

      await this.recomputeRatingSummary(current.hotelId.toHexString(), session);
      result = this.toView(updated);
    });

    if (!result) {
      throw new InternalServerErrorException({
        code: ErrorCode.InternalError,
        message: 'Review transaction completed without a result',
      });
    }
    return result;
  }

  async delete(reviewId: string, userId: string): Promise<void> {
    const reviewObjectId = this.parseId(reviewId, 'id');
    const userObjectId = this.parseId(userId, 'userId');

    await this.inTransaction(async (session) => {
      const review = await this.reviewModel
        .findOne({ _id: reviewObjectId, userId: userObjectId })
        .session(session)
        .lean<StoredReview>();
      if (!review) throw this.notFound();

      const result = await this.reviewModel.deleteOne(
        { _id: reviewObjectId, userId: userObjectId },
        { session },
      );
      if (result.deletedCount !== 1) throw this.notFound();

      await this.recomputeRatingSummary(review.hotelId.toHexString(), session);
    });
  }

  async listForHotel(
    hotelId: string,
    query: ListHotelReviewsQuery = {},
  ): Promise<Paginated<HotelReviewListItemView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    this.validatePagination(page, limit);
    const hotelObjectId = this.parseId(hotelId, 'id');

    const hotel = await this.hotels.getHotel(hotelObjectId.toHexString());
    if (!hotel) throw this.notFound();

    const filter: QueryFilter<StoredReview> = {
      hotelId: hotelObjectId,
      isHidden: false,
    };
    const result = await paginate(
      this.reviewModel,
      filter,
      { page, limit },
      { sort: { createdAt: -1, _id: -1 } },
    );

    const reviews = result.items as StoredReview[];
    const profiles = await this.accounts.getProfiles(
      reviews.map((review) => review.userId.toHexString()),
    );
    const names = new Map(
      profiles.map((profile) => [profile.id, profile.name]),
    );

    return {
      ...result,
      items: reviews.map((review) => ({
        ...this.toView(review),
        authorName: names.get(review.userId.toHexString()) ?? null,
      })),
    };
  }

  async reviewExists(reviewId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(reviewId)) return false;
    return Boolean(
      await this.reviewModel.exists({ _id: new Types.ObjectId(reviewId) }),
    );
  }

  async hideByAdmin(reviewId: string): Promise<void> {
    const reviewObjectId = this.parseModerationId(reviewId);

    await this.inTransaction(async (session) => {
      const review = await this.reviewModel
        .findById(reviewObjectId)
        .session(session)
        .lean<StoredReview>();
      if (!review) throw this.notFound();

      if (!review.isHidden) {
        const result = await this.reviewModel.updateOne(
          { _id: reviewObjectId, isHidden: false },
          { $set: { isHidden: true } },
          { session },
        );
        if (!result.matchedCount) {
          const current = await this.reviewModel
            .findById(reviewObjectId)
            .session(session)
            .lean<StoredReview>();
          if (!current) throw this.notFound();
          if (!current.isHidden) {
            throw new ConflictException({
              code: ErrorCode.ConcurrentChange,
              message: 'The review changed while it was being hidden',
            });
          }
        }
      }

      await this.recomputeRatingSummary(review.hotelId.toHexString(), session);
    });
  }

  async deleteByAdmin(reviewId: string): Promise<void> {
    const reviewObjectId = this.parseModerationId(reviewId);

    await this.inTransaction(async (session) => {
      const review = await this.reviewModel
        .findById(reviewObjectId)
        .session(session)
        .lean<StoredReview>();
      if (!review) throw this.notFound();

      const result = await this.reviewModel.deleteOne(
        { _id: reviewObjectId },
        { session },
      );
      if (result.deletedCount !== 1) throw this.notFound();

      await this.recomputeRatingSummary(review.hotelId.toHexString(), session);
    });
  }

  private async recomputeRatingSummary(
    hotelId: string,
    session: ClientSession,
  ): Promise<void> {
    const [aggregate] = await this.reviewModel
      .aggregate<RatingAggregate>([
        {
          $match: {
            hotelId: new Types.ObjectId(hotelId),
            isHidden: false,
          },
        },
        {
          $group: {
            _id: null,
            average: { $avg: '$rating' },
            count: { $sum: 1 },
          },
        },
      ])
      .session(session)
      .exec();
    const summary = toHotelRatingSummary(
      aggregate?.average ?? null,
      aggregate?.count ?? 0,
    );
    await this.hotels.setRatingSummary(hotelId, summary, { session });
  }

  private async inTransaction(
    work: (session: ClientSession) => Promise<void>,
  ): Promise<void> {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }

  private parseId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: `Invalid ${field}`,
        details: [{ field, message: 'must be an ObjectId' }],
      });
    }
    return new Types.ObjectId(value);
  }

  private parseModerationId(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw this.notFound();
    return new Types.ObjectId(value);
  }

  private validatePagination(page: number, limit: number): void {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid review list pagination',
      });
    }
  }

  private toView(review: StoredReview): HotelReviewView {
    return {
      _id: review._id.toHexString(),
      rating: review.rating,
      ...(review.text !== undefined ? { text: review.text } : {}),
      isHidden: review.isHidden,
      createdAt: review.createdAt,
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Review or reservation not found',
    });
  }
}
