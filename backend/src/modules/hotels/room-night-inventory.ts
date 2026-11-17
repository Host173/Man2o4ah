import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { mongo, Types } from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import { addDays } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { HotelTransactionOptions, RoomDateRange } from './hotels.types.js';
import {
  assertDateRange,
  assertStayDates,
  normalizeAvailability,
} from './room-date-ranges.js';
import { Hotel } from './schemas/hotel.schema.js';
import { RoomNight, RoomNightKind } from './schemas/room-night.schema.js';
import { Room } from './schemas/room.schema.js';

/**
 * The only writer of room-night inventory (data-model section 4.2).
 * Every operation joins the caller's active transaction; none commits on its own.
 */
@Injectable()
export class RoomNightInventory {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name) private readonly nights: Model<RoomNight>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
  ) {}

  /** HTL-18: check-out is exclusive; any unavailable room aborts the whole hold with ROOMS_UNAVAILABLE. */
  async reserve(
    hotelId: string,
    roomIds: string[],
    checkIn: Date,
    checkOut: Date,
    reservationId: string,
    options: HotelTransactionOptions,
  ): Promise<void> {
    const session = this.requireTransaction(options);
    this.assertIds([hotelId, reservationId, ...roomIds]);
    assertStayDates(checkIn, checkOut);
    // ObjectId strings differing only in letter case still identify the same room.
    const selected = roomIds.map((id) => new Types.ObjectId(id).toHexString());
    if (!selected.length || new Set(selected).size !== selected.length) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Select at least one room, without duplicates',
      });
    }
    if (
      !(await this.hotels
        .exists({ _id: hotelId, isActive: true })
        .session(session))
    ) {
      throw new ConflictException({
        code: ErrorCode.RoomsUnavailable,
        message: 'One or more rooms are unavailable',
      });
    }
    // Consistent lock order avoids opposing multi-room requests taking rooms in reverse order.
    for (const roomId of selected.sort()) {
      const result = await this.rooms.updateOne(
        {
          _id: roomId,
          hotelId,
          isActive: true,
          availability: {
            $elemMatch: {
              fromDate: { $lte: checkIn },
              toDate: { $gte: addDays(checkOut, -1) },
            },
          },
        },
        { $inc: { inventoryVersion: 1 }, $set: { hasEverBeenReserved: true } },
        { session },
      );
      if (result.matchedCount !== 1) {
        throw new ConflictException({
          code: ErrorCode.RoomsUnavailable,
          message: 'One or more rooms are unavailable',
        });
      }
    }
    const documents: RoomNight[] = [];
    for (const roomId of selected) {
      for (let date = checkIn; date < checkOut; date = addDays(date, 1)) {
        documents.push({
          roomId: new Types.ObjectId(roomId),
          hotelId: new Types.ObjectId(hotelId),
          date,
          kind: RoomNightKind.RESERVATION,
          reservationId: new Types.ObjectId(reservationId),
        });
      }
    }
    await this.insertNights(documents, session, ErrorCode.RoomsUnavailable);
  }

  /** HTL-18/HTL-21: releases only this reservation's nights; safe to repeat. */
  async release(
    reservationId: string,
    options: HotelTransactionOptions,
  ): Promise<void> {
    const session = this.requireTransaction(options);
    this.assertIds([reservationId]);
    const filter = { reservationId, kind: RoomNightKind.RESERVATION };
    const held = await this.nights
      .find(filter)
      .select('roomId')
      .session(session)
      .lean();
    const roomIds = [
      ...new Set(held.map((night) => night.roomId.toHexString())),
    ].sort();
    for (const roomId of roomIds) await this.touchRoom(roomId, session);
    await this.nights.deleteMany(filter, { session });
  }

  /** HTL-06: inclusive dates; returns the blockId. Overlaps throw OVERLAPS_RESERVATION_OR_BLOCK. */
  async block(
    roomId: string,
    fromDate: Date,
    toDate: Date,
    options: HotelTransactionOptions,
  ): Promise<string> {
    const session = this.requireTransaction(options);
    this.assertIds([roomId]);
    assertDateRange(fromDate, toDate);
    const room = await this.touchRoom(roomId, session);
    const blockId = new Types.ObjectId();
    const documents: RoomNight[] = [];
    for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
      documents.push({
        roomId: room._id,
        hotelId: room.hotelId,
        date,
        kind: RoomNightKind.BLOCKED,
        blockId,
      });
    }
    await this.insertNights(
      documents,
      session,
      ErrorCode.OverlapsReservationOrBlock,
    );
    return blockId.toHexString();
  }

  /** HTL-06: removes only this block; a missing/already removed block is a no-op. */
  async unblock(
    blockId: string,
    options: HotelTransactionOptions,
  ): Promise<void> {
    const session = this.requireTransaction(options);
    this.assertIds([blockId]);
    const filter = { blockId, kind: RoomNightKind.BLOCKED };
    const blocked = await this.nights.findOne(filter).session(session).lean();
    if (!blocked) return;
    await this.touchRoom(blocked.roomId.toHexString(), session);
    await this.nights.deleteMany(filter, { session });
  }

  /** HTL-04/HTL-05: sorts and merges adjacent ranges, rejecting overlaps and removal of today's/future reserved nights. */
  async setAvailability(
    roomId: string,
    ranges: RoomDateRange[],
    options: HotelTransactionOptions,
  ): Promise<void> {
    const session = this.requireTransaction(options);
    this.assertIds([roomId]);
    const normalized = normalizeAvailability(ranges);
    await this.touchRoom(roomId, session);
    const excluded = await this.nights
      .exists({
        roomId,
        kind: RoomNightKind.RESERVATION,
        date: { $gte: this.today() },
        ...(normalized.length
          ? {
              $nor: normalized.map(({ fromDate, toDate }) => ({
                date: { $gte: fromDate, $lte: toDate },
              })),
            }
          : {}),
      })
      .session(session);
    if (excluded) {
      throw new ConflictException({
        code: ErrorCode.AvailabilityHasReservations,
        message: 'Availability cannot exclude reserved nights',
      });
    }
    const result = await this.rooms.updateOne(
      { _id: roomId },
      { $set: { availability: normalized } },
      { session, runValidators: true },
    );
    this.assertMatchedRoom(result.matchedCount);
  }

  /** HTL-06: rejects reservation nights from today onward with ROOM_HAS_RESERVATIONS. */
  async deactivate(
    roomId: string,
    options: HotelTransactionOptions,
  ): Promise<void> {
    const session = this.requireTransaction(options);
    this.assertIds([roomId]);
    await this.touchRoom(roomId, session);
    await this.assertNoReservations(roomId, session);
    const result = await this.rooms.updateOne(
      { _id: roomId },
      { $set: { isActive: false } },
      { session },
    );
    this.assertMatchedRoom(result.matchedCount);
  }

  /** HTL-06: also rejects previously reserved rooms with ROOM_WAS_RESERVED; removes their blocks on deletion. */
  async delete(
    roomId: string,
    options: HotelTransactionOptions,
  ): Promise<void> {
    const session = this.requireTransaction(options);
    this.assertIds([roomId]);
    const room = await this.touchRoom(roomId, session);
    await this.assertNoReservations(roomId, session);
    if (room.hasEverBeenReserved) {
      throw new ConflictException({
        code: ErrorCode.RoomWasReserved,
        message: 'A previously reserved room cannot be deleted',
      });
    }
    const result = await this.rooms.deleteOne(
      { _id: roomId, hasEverBeenReserved: false },
      { session },
    );
    this.assertMatchedRoom(result.deletedCount);
    await this.nights.deleteMany({ roomId }, { session });
  }

  private requireTransaction(options: HotelTransactionOptions): ClientSession {
    if (!options?.session?.inTransaction()) {
      throw new InternalServerErrorException({
        code: ErrorCode.InternalError,
        message: 'Inventory operations require an active caller transaction',
      });
    }
    return options.session;
  }

  private assertIds(ids: string[]): void {
    if (ids.some((id) => !Types.ObjectId.isValid(id))) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Inventory IDs must be valid ObjectIds',
      });
    }
  }

  private async touchRoom(roomId: string, session: ClientSession) {
    const room = await this.rooms
      .findOneAndUpdate(
        { _id: roomId },
        { $inc: { inventoryVersion: 1 } },
        { session, returnDocument: 'after' },
      )
      .lean();
    if (!room) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Room not found',
      });
    }
    return room;
  }

  private async assertNoReservations(
    roomId: string,
    session: ClientSession,
  ): Promise<void> {
    if (
      await this.nights
        .exists({
          roomId,
          kind: RoomNightKind.RESERVATION,
          date: { $gte: this.today() },
        })
        .session(session)
    ) {
      throw new ConflictException({
        code: ErrorCode.RoomHasReservations,
        message: 'Room has reserved nights from today onward',
      });
    }
  }

  private async insertNights(
    documents: RoomNight[],
    session: ClientSession,
    code:
      | typeof ErrorCode.RoomsUnavailable
      | typeof ErrorCode.OverlapsReservationOrBlock,
  ): Promise<void> {
    try {
      await this.nights.insertMany(documents, { session, ordered: true });
    } catch (error) {
      if (
        error instanceof mongo.MongoServerError &&
        error.code === 11000 &&
        !error.hasErrorLabel('TransientTransactionError')
      ) {
        throw new ConflictException({
          code,
          message: 'One or more nights are already reserved or blocked',
        });
      }
      throw error;
    }
  }

  private assertMatchedRoom(count: number): void {
    if (count !== 1) {
      throw new InternalServerErrorException({
        code: ErrorCode.InventoryCorrupted,
        message: 'A locked room disappeared during an inventory operation',
      });
    }
  }

  private today(): Date {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
  }
}
