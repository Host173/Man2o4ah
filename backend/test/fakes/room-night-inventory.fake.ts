import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { addDays } from '../../src/common/dates/date-only.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type {
  HotelTransactionOptions,
  RoomDateRange,
  RoomNightView,
  RoomView,
} from '../../src/modules/hotels/hotels.types.js';
import type { RoomNightInventory } from '../../src/modules/hotels/room-night-inventory.js';
import {
  assertDateRange,
  assertStayDates,
  FakeHotelsService,
} from './hotels.fake.js';
import type { PublicApi } from './public-api.js';

/** Atomic within this in-memory dataset; does not emulate MongoDB transactions. */
export class FakeRoomNightInventory implements PublicApi<RoomNightInventory> {
  constructor(private readonly hotels: FakeHotelsService) {}

  async reserve(
    hotelId: string,
    roomIds: string[],
    checkIn: Date,
    checkOut: Date,
    reservationId: string,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void options;
    assertStayDates(checkIn, checkOut);
    if (roomIds.length === 0 || new Set(roomIds).size !== roomIds.length) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Select at least one room, without duplicates',
      });
    }
    const hotel = this.hotels.data.hotels.find((item) => item.id === hotelId);
    const freeRooms = this.hotels.availableRooms(hotelId, checkIn, checkOut);
    if (
      !hotel?.isActive ||
      roomIds.some((id) => !freeRooms.some((room) => room.id === id))
    ) {
      throw new ConflictException({
        code: ErrorCode.RoomsUnavailable,
        message: 'One or more rooms are unavailable',
      });
    }
    for (const room of freeRooms.filter((item) => roomIds.includes(item.id))) {
      room.hasEverBeenReserved = true;
      for (let date = checkIn; date < checkOut; date = addDays(date, 1)) {
        this.hotels.data.roomNights.push({
          roomId: room.id,
          hotelId,
          date: new Date(date),
          kind: 'reservation',
          reservationId,
        });
      }
    }
  }

  async release(
    reservationId: string,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void options;
    this.removeNights(
      (night) =>
        night.kind === 'reservation' && night.reservationId === reservationId,
    );
  }

  async block(
    roomId: string,
    fromDate: Date,
    toDate: Date,
    options?: HotelTransactionOptions,
  ): Promise<string> {
    void options;
    assertDateRange(fromDate, toDate);
    const room = this.requireRoom(roomId);
    if (
      this.hotels.data.roomNights.some(
        (night) =>
          night.roomId === roomId &&
          night.date >= fromDate &&
          night.date <= toDate,
      )
    ) {
      throw new ConflictException({
        code: ErrorCode.OverlapsReservationOrBlock,
        message: 'The range overlaps a reservation or block',
      });
    }
    const blockId = new Types.ObjectId().toHexString();
    for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
      this.hotels.data.roomNights.push({
        roomId,
        hotelId: room.hotelId,
        date: new Date(date),
        kind: 'blocked',
        blockId,
      });
    }
    return blockId;
  }

  async unblock(
    blockId: string,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void options;
    this.removeNights(
      (night) => night.kind === 'blocked' && night.blockId === blockId,
    );
  }

  async setAvailability(
    roomId: string,
    ranges: RoomDateRange[],
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void options;
    const room = this.requireRoom(roomId);
    for (const range of ranges) assertDateRange(range.fromDate, range.toDate);
    const sorted = structuredClone(ranges).sort(
      (a, b) => a.fromDate.getTime() - b.fromDate.getTime(),
    );
    const normalized: RoomDateRange[] = [];
    for (const range of sorted) {
      const previous = normalized.at(-1);
      if (previous && range.fromDate <= previous.toDate) {
        throw new BadRequestException({
          code: ErrorCode.ValidationFailed,
          message: 'Availability ranges must not overlap',
        });
      }
      if (
        previous &&
        range.fromDate.getTime() === addDays(previous.toDate, 1).getTime()
      ) {
        previous.toDate = range.toDate;
      } else {
        normalized.push(range);
      }
    }
    if (
      this.futureReservations(roomId).some(
        (night) =>
          !normalized.some(
            (range) =>
              range.fromDate <= night.date && range.toDate >= night.date,
          ),
      )
    ) {
      throw new ConflictException({
        code: ErrorCode.AvailabilityHasReservations,
        message: 'Availability cannot exclude reserved nights',
      });
    }
    room.availability = normalized;
  }

  async deactivate(
    roomId: string,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void options;
    const room = this.requireRoom(roomId);
    this.assertNoFutureReservations(roomId);
    room.isActive = false;
  }

  async delete(
    roomId: string,
    options?: HotelTransactionOptions,
  ): Promise<void> {
    void options;
    const room = this.requireRoom(roomId);
    this.assertNoFutureReservations(roomId);
    if (room.hasEverBeenReserved) {
      throw new ConflictException({
        code: ErrorCode.RoomWasReserved,
        message: 'A previously reserved room cannot be deleted',
      });
    }
    const rooms = this.hotels.data.rooms;
    rooms.splice(rooms.indexOf(room), 1);
    this.removeNights((night) => night.roomId === roomId);
  }

  private requireRoom(roomId: string): RoomView {
    const room = this.hotels.data.rooms.find((item) => item.id === roomId);
    if (!room) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Room not found',
      });
    }
    return room;
  }

  private futureReservations(roomId: string): RoomNightView[] {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return this.hotels.data.roomNights.filter(
      (night) =>
        night.roomId === roomId &&
        night.kind === 'reservation' &&
        night.date >= today,
    );
  }

  private assertNoFutureReservations(roomId: string): void {
    if (this.futureReservations(roomId).length) {
      throw new ConflictException({
        code: ErrorCode.RoomHasReservations,
        message: 'Room has reserved nights from today onward',
      });
    }
  }

  private removeNights(predicate: (night: RoomNightView) => boolean): void {
    const nights = this.hotels.data.roomNights;
    for (let index = nights.length - 1; index >= 0; index--) {
      if (predicate(nights[index])) nights.splice(index, 1);
    }
  }
}
