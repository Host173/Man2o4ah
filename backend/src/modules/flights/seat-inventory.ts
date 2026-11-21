import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type {
  AddCabinInput,
  InventoryOptions,
  SeatItem,
} from './flights.types.js';
import { validateCabinInput } from './cabin-input.js';
import { Flight, FlightStatus } from './schemas/flight.schema.js';

@Injectable()
export class SeatInventory {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
  ) {}

  /**
   * Initializes one unique cabin on the moderator's scheduled flight (FLT-04).
   * The insert and any caller writes share the required caller transaction.
   */
  async addCabin(
    flightId: string,
    input: AddCabinInput,
    moderatorAirlineId: string,
    options: InventoryOptions,
  ): Promise<void> {
    validateCabinInput(input);
    if (
      !Types.ObjectId.isValid(flightId) ||
      !Types.ObjectId.isValid(moderatorAirlineId)
    ) {
      throw flightNotFound();
    }
    const filter = {
      _id: new Types.ObjectId(flightId),
      airlineId: new Types.ObjectId(moderatorAirlineId),
    };
    const result = await this.flightModel
      .updateOne(
        {
          ...filter,
          status: FlightStatus.SCHEDULED,
          'cabins.cabinClass': { $ne: input.cabinClass },
        },
        {
          $push: {
            cabins: {
              cabinClass: input.cabinClass,
              totalSeats: input.totalSeats,
              availableSeats: input.totalSeats,
              heldSeats: 0,
              bookedSeats: 0,
              priceMinor: input.priceMinor,
              freeBags: input.freeBags,
              maxBagWeightKg: input.maxBagWeightKg,
            },
          },
        },
        { session: options.session, runValidators: true },
      )
      .exec();
    if (result.modifiedCount === 1) return;

    const current = await this.flightModel
      .findOne(filter)
      .session(options.session)
      .select({ status: 1, 'cabins.cabinClass': 1 })
      .lean()
      .exec();
    if (!current) throw flightNotFound();
    if (current.status !== FlightStatus.SCHEDULED) {
      throw new ConflictException({
        code: ErrorCode.InvalidStatusTransition,
        message: 'Only scheduled flights can be edited',
      });
    }
    throw new ConflictException({
      code: ErrorCode.Conflict,
      message: current.cabins.some(
        (cabin) => cabin.cabinClass === input.cabinClass,
      )
        ? 'This flight already has that cabin class'
        : 'Flight changed before the cabin could be added',
    });
  }

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

  /**
   * Converts held seats into booked seats with one conditional update per item.
   * Refuses (409 SEATS_UNAVAILABLE) when the flight is no longer scheduled, so a
   * booking can never be confirmed on a cancelled or departed flight (FLT-06).
   */
  async confirm(items: SeatItem[], options: InventoryOptions): Promise<void> {
    await this.moveHeldSeats(items, options, 'bookedSeats', true);
  }

  /** Returns held seats to availability with one conditional update per item. */
  async release(items: SeatItem[], options: InventoryOptions): Promise<void> {
    await this.moveHeldSeats(items, options, 'availableSeats', false);
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
    requireScheduled: boolean,
  ): Promise<void> {
    this.assertValidItems(items);
    for (const item of items) {
      const flightId = this.objectId(item.flightId, inventoryCorrupted);
      const cabinId = this.objectId(item.cabinId, inventoryCorrupted);
      const result = await this.flightModel
        .updateOne(
          {
            _id: flightId,
            ...(requireScheduled ? { status: FlightStatus.SCHEDULED } : {}),
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
      if (result.modifiedCount === 1) continue;
      if (requireScheduled) await this.assertStillScheduled(flightId, options);
      throw inventoryCorrupted();
    }
  }

  /**
   * Tells a flight that left the schedule apart from broken counters. Read in
   * the same session, so it sees what the failed update saw.
   */
  private async assertStillScheduled(
    flightId: Types.ObjectId,
    options: InventoryOptions,
  ): Promise<void> {
    const flight = await this.flightModel
      .findOne({ _id: flightId })
      .session(options.session)
      .select({ status: 1 })
      .lean()
      .exec();
    if (flight && flight.status !== FlightStatus.SCHEDULED) {
      throw flightNoLongerScheduled();
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

function flightNotFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'Flight not found',
  });
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

function flightNoLongerScheduled(): ConflictException {
  return new ConflictException({
    code: ErrorCode.SeatsUnavailable,
    message: 'The flight is no longer scheduled',
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
