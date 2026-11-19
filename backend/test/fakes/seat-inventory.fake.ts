import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type {
  CabinView,
  FlightView,
  SeatItem,
} from '../../src/modules/flights/flights.types.js';
import type { SeatInventory } from '../../src/modules/flights/seat-inventory.js';
import { FakeFlightsData } from './flights-data.fake.js';
import type { PublicApi } from './public-api.js';

/** The four counters of one cabin. */
export interface SeatCounters {
  totalSeats: number;
  availableSeats: number;
  heldSeats: number;
  bookedSeats: number;
}

/**
 * A working `SeatInventory` that keeps real counters, with the same rules and
 * errors as data-model 4.1. It has no transactions, so it fakes the rollback: a
 * call changes every item or none, like a transaction that aborts. The
 * `session` the real methods take is not needed here, so the fake leaves it out.
 */
export class FakeSeatInventory implements PublicApi<SeatInventory> {
  constructor(readonly data: FakeFlightsData = new FakeFlightsData()) {}

  /** The current counters of a cabin, as a copy; `undefined` if the flight or cabin doesn't exist. */
  counters(flightId: string, cabinId: string): SeatCounters | undefined {
    const cabin = this.data
      .flight(flightId)
      ?.cabins.find((c) => c.id === cabinId);
    if (!cabin) return undefined;
    const { totalSeats, availableSeats, heldSeats, bookedSeats } = cabin;
    return { totalSeats, availableSeats, heldSeats, bookedSeats };
  }

  hold(items: SeatItem[]): Promise<void> {
    return this.atomically(items, (flight, cabin, seats) => {
      const bookable =
        flight !== undefined &&
        flight.status === 'scheduled' &&
        flight.departureAt.getTime() > Date.now();
      if (!bookable || !cabin || cabin.availableSeats < seats) {
        throw seatsUnavailable();
      }
      cabin.availableSeats -= seats;
      cabin.heldSeats += seats;
      flight.hasBookings = true;
    });
  }

  confirm(items: SeatItem[]): Promise<void> {
    return this.atomically(items, (_flight, cabin, seats) => {
      if (!cabin || cabin.heldSeats < seats) throw inventoryCorrupted();
      cabin.heldSeats -= seats;
      cabin.bookedSeats += seats;
    });
  }

  release(items: SeatItem[]): Promise<void> {
    return this.atomically(items, (_flight, cabin, seats) => {
      if (!cabin || cabin.heldSeats < seats) throw inventoryCorrupted();
      cabin.heldSeats -= seats;
      cabin.availableSeats += seats;
    });
  }

  returnBooked(items: SeatItem[]): Promise<void> {
    return this.atomically(items, (_flight, cabin, seats) => {
      if (!cabin || cabin.bookedSeats < seats) throw inventoryCorrupted();
      cabin.bookedSeats -= seats;
      cabin.availableSeats += seats;
    });
  }

  changeCapacity(
    flightId: string,
    cabinId: string,
    newTotal: number,
    expectedTotal: number,
  ): Promise<void> {
    const details: ValidationDetail[] = [];
    if (!Number.isInteger(newTotal) || newTotal < 1) {
      details.push({
        field: 'newTotal',
        message: 'must be a positive integer',
      });
    }
    if (!Number.isInteger(expectedTotal)) {
      details.push({ field: 'expectedTotal', message: 'must be an integer' });
    }
    if (details.length > 0) {
      return Promise.reject(
        validationFailed('Invalid capacity change', details),
      );
    }
    const cabin = this.data
      .flight(flightId)
      ?.cabins.find((c) => c.id === cabinId);
    // Like the real update: when its filter matches nothing, the total the caller saw
    // is out of date (a missing cabin counts as changed) or the cut is too deep.
    if (!cabin || cabin.totalSeats !== expectedTotal) {
      return Promise.reject(concurrentChange());
    }
    if (cabin.availableSeats < expectedTotal - newTotal) {
      return Promise.reject(capacityBelowReserved());
    }
    const delta = newTotal - expectedTotal;
    cabin.totalSeats += delta;
    cabin.availableSeats += delta;
    return Promise.resolve();
  }

  /**
   * Runs `change` for each item in order. If any item throws, every flight touched is put
   * back as it was before the call and the error is rethrown: the rollback of the real transaction.
   */
  private atomically(
    items: SeatItem[],
    change: (
      flight: FlightView | undefined,
      cabin: CabinView | undefined,
      seats: number,
    ) => void,
  ): Promise<void> {
    const details: ValidationDetail[] = [];
    items.forEach((item, index) => {
      if (!Number.isInteger(item.seats) || item.seats < 1) {
        details.push({
          field: `items.${index}.seats`,
          message: 'must be a positive integer',
        });
      }
    });
    if (details.length > 0) {
      return Promise.reject(
        validationFailed('Seats must be positive integers', details),
      );
    }
    const before = new Map<string, FlightView>();
    try {
      for (const item of items) {
        const flight = this.data.flight(item.flightId);
        if (flight && !before.has(flight.id)) {
          before.set(flight.id, structuredClone(flight));
        }
        const cabin = flight?.cabins.find((c) => c.id === item.cabinId);
        change(flight, cabin, item.seats);
      }
      return Promise.resolve();
    } catch (error) {
      for (const [id, copy] of before) {
        const live = this.data.flight(id);
        if (live) Object.assign(live, copy);
      }
      return Promise.reject(
        error instanceof Error ? error : new Error('failed'),
      );
    }
  }
}

interface ValidationDetail {
  field: string;
  message: string;
}

function validationFailed(message: string, details: ValidationDetail[]) {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message,
    details,
  });
}

function seatsUnavailable() {
  return new ConflictException({
    code: ErrorCode.SeatsUnavailable,
    message: 'Not enough seats available',
  });
}

function inventoryCorrupted() {
  return new InternalServerErrorException({
    code: ErrorCode.InventoryCorrupted,
    message: 'Seat counters are inconsistent',
  });
}

function concurrentChange() {
  return new ConflictException({
    code: ErrorCode.ConcurrentChange,
    message: 'The cabin was changed by someone else',
  });
}

function capacityBelowReserved() {
  return new ConflictException({
    code: ErrorCode.CapacityBelowReserved,
    message: 'Capacity cannot go below held and booked seats',
  });
}
