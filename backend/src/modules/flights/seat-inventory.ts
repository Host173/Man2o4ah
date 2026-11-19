import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { InventoryOptions, SeatItem } from './flights.types.js';
import { Flight, FlightStatus } from './schemas/flight.schema.js';

@Injectable()
export class SeatInventory {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
  ) {}

  /**
   * Reserves seats conditionally on one flight-document update per item.
   * The caller's transaction makes a multi-item hold all-or-nothing.
   */
  async hold(items: SeatItem[], options: InventoryOptions): Promise<void> {
    this.assertValidItems(items);
    for (const item of items) {
      const flightId = this.objectId(item.flightId, seatsUnavailable);
      const cabinId = this.objectId(item.cabinId, seatsUnavailable);
      const result = await this.flightModel
        .updateOne(
          {
            _id: flightId,
            status: FlightStatus.SCHEDULED,
            departureAt: { $gt: new Date() },
            cabins: {
              $elemMatch: {
                _id: cabinId,
                availableSeats: { $gte: item.seats },
              },
            },
          },
          {
            $inc: {
              'cabins.$.availableSeats': -item.seats,
              'cabins.$.heldSeats': item.seats,
            },
            $set: { hasBookings: true },
          },
          { session: options.session },
        )
        .exec();
      if (result.modifiedCount !== 1) throw seatsUnavailable();
    }
  }

  /** Converts held seats into booked seats with one conditional update per item. */
  async confirm(items: SeatItem[], options: InventoryOptions): Promise<void> {
    await this.moveHeldSeats(items, options, 'bookedSeats');
  }

  /** Returns held seats to availability with one conditional update per item. */
  async release(items: SeatItem[], options: InventoryOptions): Promise<void> {
    await this.moveHeldSeats(items, options, 'availableSeats');
  }

  /** Returns booked seats to availability with one conditional update per item. */
  async returnBooked(
    items: SeatItem[],
    options: InventoryOptions,
  ): Promise<void> {
    this.assertValidItems(items);
    for (const item of items) {
      const flightId = this.objectId(item.flightId, inventoryCorrupted);
      const cabinId = this.objectId(item.cabinId, inventoryCorrupted);
      const result = await this.flightModel
        .updateOne(
          {
            _id: flightId,
            cabins: {
              $elemMatch: {
                _id: cabinId,
                bookedSeats: { $gte: item.seats },
              },
            },
          },
          {
            $inc: {
              'cabins.$.bookedSeats': -item.seats,
              'cabins.$.availableSeats': item.seats,
            },
          },
          { session: options.session },
        )
        .exec();
      if (result.modifiedCount !== 1) throw inventoryCorrupted();
    }
  }

  /**
   * Changes capacity only when the caller's observed total still matches.
   * A failed conditional update is inspected in the same session to distinguish
   * a stale total from a cut below held plus booked seats.
   */
  async changeCapacity(
    flightIdValue: string,
    cabinIdValue: string,
    newTotal: number,
    expectedTotal: number,
    options: InventoryOptions,
  ): Promise<void> {
    const details: ValidationDetail[] = [];
    if (!Number.isInteger(newTotal) || newTotal < 1) {
      details.push({
        field: 'newTotal',
        message: 'must be a positive integer',
      });
    }
    // Without this, Mongoose casts "5" to 5 and turns NaN into a CastError (500).
    if (!Number.isInteger(expectedTotal)) {
      details.push({ field: 'expectedTotal', message: 'must be an integer' });
    }
    if (details.length > 0) {
      throw validationFailed('Invalid capacity change', details);
    }
    const flightId = this.objectId(flightIdValue, concurrentChange);
    const cabinId = this.objectId(cabinIdValue, concurrentChange);
    const availableReduction = Math.max(0, expectedTotal - newTotal);
    const result = await this.flightModel
      .updateOne(
        {
          _id: flightId,
          cabins: {
            $elemMatch: {
              _id: cabinId,
              totalSeats: expectedTotal,
              availableSeats: { $gte: availableReduction },
            },
          },
        },
        {
          $inc: {
            'cabins.$.totalSeats': newTotal - expectedTotal,
            'cabins.$.availableSeats': newTotal - expectedTotal,
          },
        },
        { session: options.session },
      )
      .exec();
    if (result.matchedCount === 1) return;

    const flight = await this.flightModel
      .findOne({
        _id: flightId,
        cabins: { $elemMatch: { _id: cabinId } },
      })
      .session(options.session)
      .select({ 'cabins.$': 1 })
      .lean()
      .exec();
    const cabin = flight?.cabins[0];
    if (!cabin || cabin.totalSeats !== expectedTotal) {
      throw concurrentChange();
    }
    throw capacityBelowReserved();
  }

  private async moveHeldSeats(
    items: SeatItem[],
    options: InventoryOptions,
    destination: 'bookedSeats' | 'availableSeats',
  ): Promise<void> {
    this.assertValidItems(items);
    for (const item of items) {
      const flightId = this.objectId(item.flightId, inventoryCorrupted);
      const cabinId = this.objectId(item.cabinId, inventoryCorrupted);
      const result = await this.flightModel
        .updateOne(
          {
            _id: flightId,
            cabins: {
              $elemMatch: {
                _id: cabinId,
                heldSeats: { $gte: item.seats },
              },
            },
          },
          {
            $inc: {
              'cabins.$.heldSeats': -item.seats,
              [`cabins.$.${destination}`]: item.seats,
            },
          },
          { session: options.session },
        )
        .exec();
      if (result.modifiedCount !== 1) throw inventoryCorrupted();
    }
  }

  private objectId(
    value: string,
    error: () => ConflictException | InternalServerErrorException,
  ): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw error();
    return new Types.ObjectId(value);
  }

  /**
   * Checks every item before any update runs, so a bad later item can never leave
   * earlier ones applied. A bad `seats` is the caller's input error: 400, not 500.
   */
  private assertValidItems(items: SeatItem[]): void {
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
      throw validationFailed('Seats must be positive integers', details);
    }
  }
}

interface ValidationDetail {
  field: string;
  message: string;
}

function validationFailed(
  message: string,
  details: ValidationDetail[],
): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message,
    details,
  });
}

function seatsUnavailable(): ConflictException {
  return new ConflictException({
    code: ErrorCode.SeatsUnavailable,
    message: 'Not enough seats available',
  });
}

function inventoryCorrupted(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: ErrorCode.InventoryCorrupted,
    message: 'Seat counters are inconsistent',
  });
}

function concurrentChange(): ConflictException {
  return new ConflictException({
    code: ErrorCode.ConcurrentChange,
    message: 'The cabin was changed by someone else',
  });
}

function capacityBelowReserved(): ConflictException {
  return new ConflictException({
    code: ErrorCode.CapacityBelowReserved,
    message: 'Capacity cannot go below held and booked seats',
  });
}
