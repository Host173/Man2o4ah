import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { paginate } from '../../common/pagination/paginate.js';
import { toPage } from '../../common/pagination/paginated.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import type { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { HotelsService } from '../hotels/hotels.service.js';
import type { HotelAvailabilityQueryDto } from './dto/hotel-availability-query.dto.js';
import type {
  ModeratorReservationDto,
  ModeratorRoomStatusDto,
  RoomNightStatusDto,
} from './dto/hotel-moderator.response.dto.js';
import { HotelReservation } from './schemas/hotel-reservation.schema.js';

@Injectable()
export class HotelModeratorService {
  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservation>,
    @Inject(HotelsService) private readonly hotels: HotelsService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  /** HTL-22: guest, dates and status for the authenticated moderator's hotel, check-in then ID ascending. */
  async listReservations(
    hotelId: string,
    query: PaginationQueryDto,
    moderatorHotelId: string | undefined,
  ): Promise<Paginated<ModeratorReservationDto>> {
    const id = await this.assignedHotel(hotelId, moderatorHotelId);
    const page = await paginate(this.reservations, { hotelId: id }, query, {
      sort: { checkInDate: 1, _id: 1 },
      projection: {
        userId: 1,
        reference: 1,
        checkInDate: 1,
        checkOutDate: 1,
        status: 1,
      },
    });
    const profiles = page.items.length
      ? await this.accounts.getProfiles([
          ...new Set(
            page.items.map((reservation) => reservation.userId.toString()),
          ),
        ])
      : [];
    const names = new Map(
      profiles.map((profile) => [profile.id, profile.name]),
    );
    return toPage(
      page.items.map((reservation) => ({
        _id: reservation._id.toString(),
        ...(reservation.reference ? { reference: reservation.reference } : {}),
        guest: {
          _id: reservation.userId.toString(),
          ...(names.has(reservation.userId.toString())
            ? { name: names.get(reservation.userId.toString()) }
            : {}),
        },
        checkInDate: reservation.checkInDate.toISOString().slice(0, 10),
        checkOutDate: reservation.checkOutDate.toISOString().slice(0, 10),
        status: reservation.status,
      })),
      page.total,
      page.page,
      page.limit,
    );
  }

  /** HTL-08: inclusive nightly statuses, paginated by room. References are joined only within this module. */
  async availability(
    hotelId: string,
    query: HotelAvailabilityQueryDto,
    moderatorHotelId: string | undefined,
  ): Promise<Paginated<ModeratorRoomStatusDto>> {
    const id = await this.assignedHotel(hotelId, moderatorHotelId);
    const from = this.parseDate(query.from, 'from');
    const to = this.parseDate(query.to, 'to');
    if (to < from) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid date range',
        details: [{ field: 'to', message: 'must be on or after from' }],
      });
    }
    const rooms = await this.hotels.listRooms(
      id.toString(),
      query,
      moderatorHotelId,
    );
    if (!rooms.items.length)
      return toPage([], rooms.total, rooms.page, rooms.limit);
    const roomIds = new Set(rooms.items.map((room) => room.id));
    const nights = (
      await this.hotels.getRoomNights(id.toString(), from, to)
    ).filter((night) => roomIds.has(night.roomId));
    const reservationIds = [
      ...new Set(
        nights.flatMap((night) =>
          night.kind === 'reservation' ? [night.reservationId] : [],
        ),
      ),
    ];
    const reservations = reservationIds.length
      ? await this.reservations
          .find(
            {
              hotelId: id,
              _id: { $in: reservationIds },
            },
            { reference: 1 },
          )
          .lean()
          .exec()
      : [];
    const references = new Map(
      reservations.map((reservation) => [
        reservation._id.toString(),
        reservation.reference,
      ]),
    );
    const taken = new Map(
      nights.map((night) => [
        `${night.roomId}:${night.date.toISOString().slice(0, 10)}`,
        night,
      ]),
    );
    const items = rooms.items.map((room): ModeratorRoomStatusDto => {
      const statuses: RoomNightStatusDto[] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) {
        const day = date.toISOString().slice(0, 10);
        const night = taken.get(`${room.id}:${day}`);
        if (night?.kind === 'reservation') {
          if (!references.has(night.reservationId)) {
            throw new InternalServerErrorException({
              code: ErrorCode.InventoryCorrupted,
              message:
                'Room night points to a missing reservation in this hotel',
            });
          }
          const reference = references.get(night.reservationId);
          statuses.push({
            date: day,
            status: 'booked',
            reservationId: night.reservationId,
            ...(reference ? { reference } : {}),
          });
        } else if (night?.kind === 'blocked') {
          statuses.push({
            date: day,
            status: 'blocked',
            reason: 'blocked_range',
          });
        } else if (!room.isActive) {
          statuses.push({
            date: day,
            status: 'blocked',
            reason: 'inactive_room',
          });
        } else if (
          !room.availability.some(
            (range) => range.fromDate <= date && date <= range.toDate,
          )
        ) {
          statuses.push({
            date: day,
            status: 'blocked',
            reason: 'outside_availability',
          });
        } else {
          statuses.push({ date: day, status: 'available' });
        }
      }
      return {
        _id: room.id,
        name: room.name,
        type: room.type,
        isActive: room.isActive,
        nights: statuses,
      };
    });
    return toPage(items, rooms.total, rooms.page, rooms.limit);
  }

  private async assignedHotel(
    hotelId: string,
    moderatorHotelId: string | undefined,
  ): Promise<Types.ObjectId> {
    if (!/^[a-f\d]{24}$/i.test(hotelId)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid hotel ID',
        details: [{ field: 'id', message: 'must be a MongoDB ObjectId' }],
      });
    }
    const id = new Types.ObjectId(hotelId);
    if (
      !moderatorHotelId ||
      id.toString() !== moderatorHotelId.toLowerCase() ||
      !(await this.hotels.getHotel(id.toString()))
    ) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Hotel not found',
      });
    }
    return id;
  }

  private parseDate(value: string, field: string): Date {
    try {
      return toDateOnly(value);
    } catch {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid calendar date',
        details: [{ field, message: 'must be a real date as YYYY-MM-DD' }],
      });
    }
  }
}
