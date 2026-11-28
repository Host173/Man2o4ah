import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model, QueryFilter, SortOrder } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import type { ErrorDetail } from '../../common/errors/error-body.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { paginate } from '../../common/pagination/paginate.js';
import { toPage } from '../../common/pagination/paginated.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { BookingType } from '../../common/database/booking-type.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { RefundView } from '../payments/payments.types.js';
import {
  HotelReservationGroup,
  type HotelReservationDetailView,
  type HotelReservationSummaryView,
  type ListMyHotelReservationsQuery,
} from './hotel-bookings.types.js';
import {
  HotelReservation,
  HotelReservationStatus,
  type ReservedRoom,
} from './schemas/hotel-reservation.schema.js';

type StoredReservedRoom = ReservedRoom & { _id?: Types.ObjectId };
type StoredHotelReservation = Omit<HotelReservation, 'rooms'> & {
  _id: Types.ObjectId;
  rooms: StoredReservedRoom[];
  createdAt: Date;
  updatedAt: Date;
};

const toYmd = (date: Date): string => date.toISOString().slice(0, 10);

function notFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'Reservation not found',
  });
}

function missingHotelMetadata(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: ErrorCode.InternalError,
    message: 'Hotel metadata is unavailable',
  });
}

/**
 * Owner-only reservation listing and detail views (HTL-20, ACC-11).
 * Preserves snapshotted rooms, prices and policies while reading current
 * hotel display metadata through `HotelsService`. Never mutates reservations
 * or generates references on read.
 */
@Injectable()
export class HotelReservationsService {
  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservationModel: Model<StoredHotelReservation>,
    private readonly hotels: HotelsService,
    private readonly payments: PaymentsService,
  ) {}

  async listMine(
    userId: string,
    query: ListMyHotelReservationsQuery = {},
    now: Date = new Date(),
  ): Promise<Paginated<HotelReservationSummaryView>> {
    const group = query.group ?? HotelReservationGroup.UPCOMING;
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    this.validateListQuery(group, page, limit);

    if (!Types.ObjectId.isValid(userId)) {
      return toPage([], 0, page, limit);
    }

    const ownerId = new Types.ObjectId(userId);
    const today = toDateOnly(now.toISOString().slice(0, 10));
    const { filter, sort } = this.groupQuery(ownerId, group, today, now);

    const result = await paginate(
      this.reservationModel,
      filter,
      { page, limit },
      { sort },
    );

    const hotelIds = [
      ...new Set(result.items.map((item) => item.hotelId.toHexString())),
    ];
    const hotels = await Promise.all(
      hotelIds.map(async (hotelId) => {
        const hotel = await this.hotels.getHotel(hotelId);
        if (!hotel) throw missingHotelMetadata();
        return [hotelId, hotel.name] as const;
      }),
    );
    const hotelNames = new Map(hotels);

    return {
      ...result,
      items: result.items.map((item) =>
        this.toSummary(
          item as StoredHotelReservation,
          hotelNames.get(item.hotelId.toHexString())!,
        ),
      ),
    };
  }

  async getMineById(
    reservationId: string,
    userId: string,
  ): Promise<HotelReservationDetailView> {
    if (!Types.ObjectId.isValid(reservationId)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid reservation ID',
        details: [{ field: 'id', message: 'must be an ObjectId' }],
      });
    }
    if (!Types.ObjectId.isValid(userId)) {
      throw notFound();
    }

    const reservation = await this.reservationModel
      .findOne({
        _id: new Types.ObjectId(reservationId),
        userId: new Types.ObjectId(userId),
      })
      .lean<StoredHotelReservation>();
    if (!reservation) throw notFound();

    const [hotel, refund] = await Promise.all([
      this.hotels.getHotel(reservation.hotelId.toHexString()),
      this.payments.getRefund(BookingType.HOTEL, reservationId),
    ]);
    if (!hotel) throw missingHotelMetadata();

    return this.toDetail(reservation, hotel.name, refund);
  }

  private validateListQuery(
    group: HotelReservationGroup,
    page: number,
    limit: number,
  ): void {
    const details: ErrorDetail[] = [];
    if (!Object.values(HotelReservationGroup).includes(group)) {
      details.push({
        field: 'group',
        message: 'must be one of upcoming, past, cancelled',
      });
    }
    if (!Number.isSafeInteger(page) || page < 1) {
      details.push({ field: 'page', message: 'must be an integer at least 1' });
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      details.push({
        field: 'limit',
        message: 'must be an integer from 1 to 50',
      });
    }
    if (details.length > 0) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid reservation list query',
        details,
      });
    }
  }

  private groupQuery(
    userId: Types.ObjectId,
    group: HotelReservationGroup,
    today: Date,
    now: Date,
  ): {
    filter: QueryFilter<StoredHotelReservation>;
    sort: Record<string, SortOrder>;
  } {
    switch (group) {
      case HotelReservationGroup.UPCOMING:
        return {
          filter: {
            userId,
            $or: [
              {
                status: HotelReservationStatus.CONFIRMED,
                checkOutDate: { $gte: today },
              },
              {
                status: HotelReservationStatus.PENDING_PAYMENT,
                checkOutDate: { $gte: today },
                holdExpiresAt: { $gt: now },
              },
            ],
          },
          sort: { checkInDate: 1, _id: 1 },
        };
      case HotelReservationGroup.PAST:
        return {
          filter: {
            userId,
            $or: [
              {
                status: {
                  $in: [
                    HotelReservationStatus.COMPLETED,
                    HotelReservationStatus.EXPIRED,
                  ],
                },
              },
              {
                status: {
                  $in: [
                    HotelReservationStatus.PENDING_PAYMENT,
                    HotelReservationStatus.CONFIRMED,
                  ],
                },
                checkOutDate: { $lt: today },
              },
              {
                status: HotelReservationStatus.PENDING_PAYMENT,
                holdExpiresAt: { $lte: now },
              },
            ],
          },
          sort: { checkInDate: -1, _id: -1 },
        };
      case HotelReservationGroup.CANCELLED:
        return {
          filter: {
            userId,
            status: HotelReservationStatus.CANCELLED,
          },
          sort: { checkInDate: -1, _id: -1 },
        };
    }
  }

  private toSummary(
    reservation: StoredHotelReservation,
    hotelName: string,
  ): HotelReservationSummaryView {
    return {
      _id: reservation._id.toHexString(),
      ...(reservation.reference !== undefined
        ? { reference: reservation.reference }
        : {}),
      status: reservation.status,
      hotelId: reservation.hotelId.toHexString(),
      hotelName,
      checkInDate: toYmd(reservation.checkInDate),
      checkOutDate: toYmd(reservation.checkOutDate),
      nights: reservation.nights,
      rooms: reservation.rooms.map((room) => ({
        roomId: room.roomId.toHexString(),
        roomName: room.roomName,
        roomType: room.roomType,
        pricePerNightMinor: room.pricePerNightMinor,
        adults: room.adults,
        childAges: [...room.childAges],
        subtotalMinor: room.subtotalMinor,
      })),
      totalMinor: reservation.totalMinor,
      currency: reservation.currency,
    };
  }

  private toDetail(
    reservation: StoredHotelReservation,
    hotelName: string,
    refund: RefundView | null,
  ): HotelReservationDetailView {
    return {
      ...this.toSummary(reservation, hotelName),
      policy: {
        cancellationTiers: reservation.policySnapshot.cancellationTiers.map(
          (tier) => ({
            daysBefore: tier.daysBefore,
            refundPercent: tier.refundPercent,
          }),
        ),
        checkInTime: reservation.policySnapshot.checkInTime,
        checkOutTime: reservation.policySnapshot.checkOutTime,
      },
      holdExpiresAt: reservation.holdExpiresAt,
      ...(reservation.confirmedAt !== undefined
        ? { confirmedAt: reservation.confirmedAt }
        : {}),
      ...(reservation.expiredAt !== undefined
        ? { expiredAt: reservation.expiredAt }
        : {}),
      ...(reservation.completedAt !== undefined
        ? { completedAt: reservation.completedAt }
        : {}),
      ...(reservation.cancellation !== undefined
        ? {
            cancellation: {
              cancelledAt: reservation.cancellation.cancelledAt,
              cancelledBy: reservation.cancellation.cancelledBy,
              refundPercent: reservation.cancellation.refundPercent,
              refundAmountMinor: reservation.cancellation.refundAmountMinor,
            },
          }
        : {}),
      refund,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    };
  }
}
