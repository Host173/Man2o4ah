import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import type { ErrorDetail } from '../../common/errors/error-body.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { getPlatformCurrency } from '../../common/money/platform-currency.js';
import { HotelsService } from '../hotels/hotels.service.js';
import type { RoomView } from '../hotels/hotels.types.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import type { HotelHoldRequestDto } from './dto/hotel-hold.dto.js';
import { HotelHoldExpiryJob } from './hotel-hold-expiry.job.js';
import type { HeldRoom, HotelHold } from './hotel-bookings.types.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';
import { priceStay } from './stay-pricing.js';
import { checkStay } from './stay-rules.js';

/** How long held rooms wait for payment (HTL-18). */
const HOLD_MINUTES = 10;

function invalid(details: ErrorDetail[]): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'The reservation request is not valid',
    details,
  });
}

/** `YYYY-MM-DD` of a DateOnly (dates travel as strings, api-contract §3). */
const toYmd = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The hotel room hold (HTL-16, HTL-18). Checks the stay and the guests against
 * the hotel's data, prices it, then, in one transaction, saves the
 * `pending_payment` reservation with its snapshots and reserves every night of
 * every room. All rooms are held or none: any taken night → 409
 * ROOMS_UNAVAILABLE (from `RoomNightInventory.reserve`) and the reservation is
 * rolled back.
 */
@Injectable()
export class HotelHoldService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HotelReservation.name)
    private readonly reservationModel: Model<HotelReservation>,
    private readonly hotels: HotelsService,
    private readonly roomNights: RoomNightInventory,
    private readonly expiry: HotelHoldExpiryJob,
  ) {}

  async hold(request: HotelHoldRequestDto, userId: string): Promise<HotelHold> {
    const dateErrors: ErrorDetail[] = [];
    const checkInDate = this.parseDate(
      request.checkInDate,
      'checkInDate',
      dateErrors,
    );
    const checkOutDate = this.parseDate(
      request.checkOutDate,
      'checkOutDate',
      dateErrors,
    );

    const [hotel, hotelRooms] = await Promise.all([
      this.hotels.getHotel(request.hotelId),
      this.hotels.getRooms(request.hotelId),
    ]);
    const today = toDateOnly(new Date().toISOString().slice(0, 10));
    const errors = [
      ...dateErrors,
      ...checkStay(
        { checkInDate, checkOutDate, rooms: request.rooms },
        hotel,
        hotelRooms,
        today,
      ),
    ];
    // With errors, a date may be missing or the hotel null, so stop here.
    if (errors.length > 0 || !hotel || !checkInDate || !checkOutDate) {
      throw invalid(errors);
    }

    const roomsById = new Map<string, RoomView>(
      hotelRooms.map((room) => [room.id, room]),
    );
    const chosen = request.rooms.map((r) => roomsById.get(r.roomId)!);
    const price = priceStay(checkInDate, checkOutDate, chosen);
    const rooms: HeldRoom[] = request.rooms.map((requested, i) => ({
      roomId: requested.roomId,
      roomName: chosen[i].name,
      roomType: chosen[i].type,
      pricePerNightMinor: chosen[i].pricePerNightMinor,
      adults: requested.adults,
      childAges: [...requested.childAges],
      subtotalMinor: price.subtotalsMinor[i],
    }));
    const policy = {
      cancellationTiers: hotel.cancellationPolicy.tiers.map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      })),
      checkInTime: hotel.checkInTime,
      checkOutTime: hotel.checkOutTime,
    };
    const currency = getPlatformCurrency();
    const createdAt = new Date();
    const holdExpiresAt = new Date(
      createdAt.getTime() + HOLD_MINUTES * 60 * 1000,
    );
    // The id is chosen up front: reserve() needs it, and a retried
    // transaction then writes the same document again.
    const reservationObjectId = new Types.ObjectId();
    const reservationId = reservationObjectId.toHexString();
    const reservation = {
      _id: reservationObjectId,
      userId,
      hotelId: request.hotelId,
      status: HotelReservationStatus.PENDING_PAYMENT,
      checkInDate,
      checkOutDate,
      nights: price.nights,
      rooms,
      totalMinor: price.totalMinor,
      currency,
      policySnapshot: policy,
      holdExpiresAt,
      // `timestamps: true` would set createdAt itself; set it here so
      // holdExpiresAt is exactly createdAt + 10 minutes.
      createdAt,
    };

    // HTL-18: only an unexpired hold blocks a room, and the expiry job may not
    // have run yet. Free the overdue holds on these rooms and nights first.
    await this.expiry.expireDueHolds(createdAt, {
      hotelId: request.hotelId,
      'rooms.roomId': { $in: request.rooms.map((r) => r.roomId) },
      checkInDate: { $lt: checkOutDate },
      checkOutDate: { $gt: checkInDate },
    });

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // The reservation first: reserve() records its id on every night.
        await this.reservationModel.create([reservation], { session });
        await this.roomNights.reserve(
          request.hotelId,
          request.rooms.map((r) => r.roomId),
          checkInDate,
          checkOutDate,
          reservationId,
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    return {
      reservationId,
      status: HotelReservationStatus.PENDING_PAYMENT,
      hotelId: request.hotelId,
      hotelName: hotel.name,
      checkInDate: toYmd(checkInDate),
      checkOutDate: toYmd(checkOutDate),
      nights: price.nights,
      rooms,
      totalMinor: price.totalMinor,
      currency,
      policy,
      holdExpiresAt,
    };
  }

  /** A real calendar date, or `undefined` with an error (e.g. 30 February). */
  private parseDate(
    value: string,
    field: string,
    errors: ErrorDetail[],
  ): Date | undefined {
    try {
      return toDateOnly(value);
    } catch {
      errors.push({ field, message: 'This date does not exist' });
      return undefined;
    }
  }
}
