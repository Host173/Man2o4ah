import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { toPage } from '../../common/pagination/paginated.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import type { AirportView } from '../reference-data/reference-data.types.js';
import { convertFlightTimes } from './flight-time.js';
import { formatLocalDateTime } from './flight-time.js';
import { AirlinesService } from './airlines.service.js';
import { validateCabinInput } from './cabin-input.js';
import { SeatInventory } from './seat-inventory.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import type {
  AddCabinInput,
  AirlineView,
  BookabilityResult,
  CreateFlightInput,
  FlightListQuery,
  FlightManagementView,
  FlightSearchItem,
  FlightWithAirline,
  OneWaySearchQuery,
  RoundTripSearchQuery,
  RoundTripSearchResult,
  SearchFlightsQuery,
  UpdateCabinInput,
  UpdateFlightInput,
} from './flights.types.js';
import { Airline } from './schemas/airline.schema.js';
import { Cabin } from './schemas/flight.schema.js';
import { Flight, FlightStatus } from './schemas/flight.schema.js';

type FlightRecord = Omit<Flight, 'airlineId' | 'cabins'> & {
  _id: Types.ObjectId;
  airlineId: Types.ObjectId;
  cabins: (Cabin & { _id: Types.ObjectId })[];
};

/**
 * What other modules may ask of flights (CTR-02). Seat counters are initialized
 * and changed only through `SeatInventory`. Getters return `null`, or leave the
 * key out of the `Map`, when something isn't found: the caller decides
 * between 400 and 404.
 */
@Injectable()
export class FlightsService {
  constructor(
    private readonly airlines: AirlinesService,

    @InjectModel(Flight.name)
    private readonly flightModel: Model<FlightRecord>,

    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,

    @Inject(ReferenceDataService)
    private readonly referenceData: ReferenceDataService,

    @InjectConnection()
    private readonly connection: Connection,

    @Inject(SeatInventory)
    private readonly seatInventory: SeatInventory,

    private readonly events: AppEvents,
  ) {}

  /**
   * Create a scheduled flight from the two airport-local times (FLT-03, FLT-02,
   * GEN-06). The airline ID must come from the authenticated moderator.
   * Duplicate flight numbers on a local departure date conflict at the schema index.
   */
  async createFlight(
    input: CreateFlightInput,
    airlineId: string,
  ): Promise<FlightManagementView> {
    const airlineObjectId = this.objectId(airlineId);
    if (!(await this.airlineModel.exists({ _id: airlineObjectId }).exec())) {
      throw this.notFound();
    }

    const flightNumber = input.flightNumber.trim().toUpperCase();
    if (!flightNumber) {
      throw this.invalidField('flightNumber', 'must not be blank');
    }

    const departureAirportId = input.departureAirportId.trim().toUpperCase();
    const arrivalAirportId = input.arrivalAirportId.trim().toUpperCase();
    if (departureAirportId === arrivalAirportId) {
      throw this.invalidField(
        'arrivalAirportId',
        'must differ from departureAirportId',
      );
    }

    const airports = await this.referenceData.getAirports([
      departureAirportId,
      arrivalAirportId,
    ]);
    const departureAirport = airports.get(departureAirportId);
    if (!departureAirport) {
      throw this.invalidField('departureAirportId', 'is not a known airport');
    }
    const arrivalAirport = airports.get(arrivalAirportId);
    if (!arrivalAirport) {
      throw this.invalidField('arrivalAirportId', 'is not a known airport');
    }

    const times = convertFlightTimes(
      input.departureLocal,
      departureAirport.timeZone,
      input.arrivalLocal,
      arrivalAirport.timeZone,
    );
    const flight = await this.flightModel.create({
      airlineId: airlineObjectId,
      flightNumber,
      departureAirportId,
      arrivalAirportId,
      ...times,
    });
    return this.toManagementView(
      flight.toObject(),
      departureAirport,
      arrivalAirport,
    );
  }

  /**
   * List an airline's flights, including each airport's time zone for local display
   * (FLT-03, FLT-02, GEN-06). The controller must scope the requested airline to
   * the authenticated moderator. Results are ordered by UTC departure then ID.
   */
  async listAirlineFlights(
    airlineId: string,
    moderatorAirlineId: string | undefined,
    query: FlightListQuery,
  ): Promise<Paginated<FlightManagementView>> {
    const airlineObjectId = this.objectId(airlineId);
    if (moderatorAirlineId !== airlineObjectId.toHexString()) {
      throw this.notFound();
    }
    if (!(await this.airlineModel.exists({ _id: airlineObjectId }).exec())) {
      throw this.notFound();
    }

    const filter = { airlineId: airlineObjectId };
    const [flights, total] = await Promise.all([
      this.flightModel
        .find(filter)
        .sort({ departureAt: 1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<FlightRecord[]>()
        .exec(),
      this.flightModel.countDocuments(filter).exec(),
    ]);
    const airportCodes = [
      ...new Set(
        flights.flatMap((flight) => [
          flight.departureAirportId,
          flight.arrivalAirportId,
        ]),
      ),
    ];
    const airports = await this.referenceData.getAirports(airportCodes);
    const items = flights.map((flight) => {
      const departureAirport = airports.get(flight.departureAirportId);
      const arrivalAirport = airports.get(flight.arrivalAirportId);
      if (!departureAirport || !arrivalAirport) {
        throw new InternalServerErrorException({
          code: ErrorCode.InternalError,
          message: 'A flight references an unknown airport',
        });
      }
      return this.toManagementView(flight, departureAirport, arrivalAirport);
    });
    return toPage(items, total, query.page, query.limit);
  }

  /**
   * Add one cabin to an assigned airline's scheduled flight (FLT-04).
   * New cabins start with every seat available; the conditional update prevents
   * duplicate cabin classes when moderators submit concurrently.
   */
  async addCabin(
    flightId: string,
    input: AddCabinInput,
    moderatorAirlineId: string | undefined,
  ): Promise<FlightManagementView> {
    validateCabinInput(input);
    const flightObjectId = this.flightObjectId(flightId);
    if (
      moderatorAirlineId === undefined ||
      !Types.ObjectId.isValid(moderatorAirlineId)
    ) {
      throw this.flightNotFound();
    }

    const airlineObjectId = new Types.ObjectId(moderatorAirlineId);
    const filter = { _id: flightObjectId, airlineId: airlineObjectId };
    const flight = await this.flightModel
      .findOne(filter)
      .lean<FlightRecord>()
      .exec();
    if (!flight) throw this.flightNotFound();
    if (flight.status !== FlightStatus.SCHEDULED) {
      throw this.flightNotScheduled();
    }
    if (flight.cabins.some((cabin) => cabin.cabinClass === input.cabinClass)) {
      throw this.cabinAlreadyExists();
    }

    const airports = await this.referenceData.getAirports([
      flight.departureAirportId,
      flight.arrivalAirportId,
    ]);
    const departureAirport = airports.get(flight.departureAirportId);
    const arrivalAirport = airports.get(flight.arrivalAirportId);
    if (!departureAirport || !arrivalAirport) {
      throw new InternalServerErrorException({
        code: ErrorCode.InternalError,
        message: 'A flight references an unknown airport',
      });
    }

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        await this.seatInventory.addCabin(flightId, input, moderatorAirlineId, {
          session,
        });
        const updated = await this.flightModel
          .findOne(filter)
          .session(session)
          .lean<FlightRecord>()
          .exec();
        if (!updated) throw this.flightNotFound();
        return this.toManagementView(updated, departureAirport, arrivalAirport);
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Edit a scheduled flight's airports and/or local times (FLT-05).
   * Airports are locked after any hold or booking. Time changes emit
   * `flight.rescheduled` after the transaction commits.
   */
  async updateFlight(
    flightId: string,
    input: UpdateFlightInput,
    moderatorAirlineId: string | undefined,
  ): Promise<FlightManagementView> {
    if (
      Object.keys(input).length === 0 ||
      (input.departureLocal === undefined &&
        input.arrivalLocal === undefined &&
        input.departureAirportId === undefined &&
        input.arrivalAirportId === undefined)
    ) {
      throw this.invalidField('input', 'at least one field must be provided');
    }

    const flightObjectId = this.flightObjectId(flightId);
    if (
      moderatorAirlineId === undefined ||
      !Types.ObjectId.isValid(moderatorAirlineId)
    ) {
      throw this.flightNotFound();
    }
    const airlineObjectId = new Types.ObjectId(moderatorAirlineId);
    const filter = { _id: flightObjectId, airlineId: airlineObjectId };
    const flight = await this.flightModel
      .findOne(filter)
      .lean<FlightRecord>()
      .exec();
    if (!flight) throw this.flightNotFound();
    if (flight.status !== FlightStatus.SCHEDULED) {
      throw this.flightNotScheduled();
    }

    const departureAirportId =
      input.departureAirportId?.trim().toUpperCase() ??
      flight.departureAirportId;
    const arrivalAirportId =
      input.arrivalAirportId?.trim().toUpperCase() ?? flight.arrivalAirportId;
    if (departureAirportId === arrivalAirportId) {
      throw this.invalidField(
        'arrivalAirportId',
        'must differ from departureAirportId',
      );
    }
    if (
      flight.hasBookings &&
      (departureAirportId !== flight.departureAirportId ||
        arrivalAirportId !== flight.arrivalAirportId)
    ) {
      throw new ConflictException({
        code: ErrorCode.Conflict,
        message: 'Airports cannot be changed after a booking or seat hold',
      });
    }

    const airports = await this.referenceData.getAirports([
      departureAirportId,
      arrivalAirportId,
    ]);
    const departureAirport = airports.get(departureAirportId);
    const arrivalAirport = airports.get(arrivalAirportId);
    if (!departureAirport || !arrivalAirport) {
      throw this.invalidField(
        !departureAirport ? 'departureAirportId' : 'arrivalAirportId',
        'is not a known airport',
      );
    }

    const departureLocal =
      input.departureLocal ??
      formatLocalDateTime(flight.departureAt, departureAirport.timeZone);
    const arrivalLocal =
      input.arrivalLocal ??
      formatLocalDateTime(flight.arrivalAt, arrivalAirport.timeZone);
    const times = convertFlightTimes(
      departureLocal,
      departureAirport.timeZone,
      arrivalLocal,
      arrivalAirport.timeZone,
    );

    const timeChanged =
      times.departureAt.getTime() !== flight.departureAt.getTime() ||
      times.arrivalAt.getTime() !== flight.arrivalAt.getTime();
    const session = await this.connection.startSession();
    try {
      let updated: FlightRecord | null = null;
      await session.withTransaction(async () => {
        const result = await this.flightModel
          .updateOne(
            { ...filter, status: FlightStatus.SCHEDULED },
            {
              $set: {
                departureAirportId,
                arrivalAirportId,
                departureAt: times.departureAt,
                arrivalAt: times.arrivalAt,
                departureLocalDate: times.departureLocalDate,
                durationMinutes: times.durationMinutes,
              },
            },
            { session, runValidators: true },
          )
          .exec();
        if (result.modifiedCount !== 1) throw this.flightNotFound();
        updated = await this.flightModel
          .findOne(filter)
          .session(session)
          .lean<FlightRecord>()
          .exec();
        if (!updated) throw this.flightNotFound();
      });
      if (timeChanged) {
        this.events.emit(Events.FlightRescheduled, {
          flightId: flightId,
          departureAt: times.departureAt,
          arrivalAt: times.arrivalAt,
        });
      }
      if (!updated) throw this.flightNotFound();
      return this.toManagementView(updated, departureAirport, arrivalAirport);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Edit a cabin's price and/or total seat count (FLT-05).
   * Capacity uses SeatInventory and cannot fall below held plus booked seats.
   */
  async updateCabin(
    flightId: string,
    cabinId: string,
    input: UpdateCabinInput,
    moderatorAirlineId: string | undefined,
  ): Promise<FlightManagementView> {
    if (input.priceMinor === undefined && input.totalSeats === undefined) {
      throw this.invalidField('input', 'at least one field must be provided');
    }
    if (
      (input.priceMinor !== undefined &&
        (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 1)) ||
      (input.totalSeats !== undefined &&
        (!Number.isSafeInteger(input.totalSeats) || input.totalSeats < 1))
    ) {
      const field =
        input.priceMinor !== undefined &&
        (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 1)
          ? 'priceMinor'
          : 'totalSeats';
      throw this.invalidField(field, 'must be a positive safe integer');
    }

    const flightObjectId = this.flightObjectId(flightId);
    const cabinObjectId = this.flightObjectId(cabinId);
    if (
      moderatorAirlineId === undefined ||
      !Types.ObjectId.isValid(moderatorAirlineId)
    ) {
      throw this.flightNotFound();
    }
    const airlineObjectId = new Types.ObjectId(moderatorAirlineId);
    const filter = { _id: flightObjectId, airlineId: airlineObjectId };
    const flight = await this.flightModel
      .findOne(filter)
      .lean<FlightRecord>()
      .exec();
    if (!flight) throw this.flightNotFound();
    if (flight.status !== FlightStatus.SCHEDULED) {
      throw this.flightNotScheduled();
    }
    const cabin = flight.cabins.find((item) => item._id.equals(cabinObjectId));
    if (!cabin) throw this.flightNotFound();

    const airports = await this.referenceData.getAirports([
      flight.departureAirportId,
      flight.arrivalAirportId,
    ]);
    const departureAirport = airports.get(flight.departureAirportId);
    const arrivalAirport = airports.get(flight.arrivalAirportId);
    if (!departureAirport || !arrivalAirport) {
      throw new InternalServerErrorException({
        code: ErrorCode.InternalError,
        message: 'A flight references an unknown airport',
      });
    }

    const session = await this.connection.startSession();
    try {
      let updated: FlightRecord | null = null;
      await session.withTransaction(async () => {
        if (input.totalSeats !== undefined) {
          await this.seatInventory.changeCapacity(
            flightId,
            cabinId,
            input.totalSeats,
            cabin.totalSeats,
            { session },
          );
        }
        if (input.priceMinor !== undefined) {
          const result = await this.flightModel
            .updateOne(
              {
                ...filter,
                status: FlightStatus.SCHEDULED,
                cabins: { $elemMatch: { _id: cabinObjectId } },
              },
              { $set: { 'cabins.$.priceMinor': input.priceMinor } },
              { session, runValidators: true },
            )
            .exec();
          if (result.modifiedCount !== 1) throw this.flightNotFound();
        }
        updated = await this.flightModel
          .findOne(filter)
          .session(session)
          .lean<FlightRecord>()
          .exec();
        if (!updated) throw this.flightNotFound();
      });
      if (!updated) throw this.flightNotFound();
      return this.toManagementView(updated, departureAirport, arrivalAirport);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Flights with their airlines, by flight ID, for pricing and snapshots (FLT-19, FLT-22, FLT-29).
   * Unknown IDs are left out. Cancelled flights and inactive airlines are still returned:
   * ask `checkBookable` whether they can be booked. Implemented in FLT-17.
   */
  getFlightsForBooking(
    flightIds: string[],
  ): Promise<Map<string, FlightWithAirline>> {
    void flightIds;
    throw new NotImplementedException(
      'getFlightsForBooking: implemented in FLT-17',
    );
  }

  /**
   * Can `seats` seats of this cabin be booked now? Airline active, flight `scheduled`,
   * departure in the future and enough available seats. The seat check is advisory:
   * only `SeatInventory.hold` is atomic. Never throws for a business reason. Implemented in FLT-17.
   */
  checkBookable(
    flightId: string,
    cabinId: string,
    seats: number,
  ): Promise<BookabilityResult> {
    void flightId;
    void cabinId;
    void seats;
    throw new NotImplementedException('checkBookable: implemented in FLT-17');
  }

  /**
   * Search bookable flights (FLT-11, FLT-12, FLT-15). One-way returns one paginated list;
   * with `returnDate` it returns `{ outbound, inbound }`, each paginated. No match is
   * `items: []`, not an error. Throws 400 `VALIDATION_FAILED` if `minPriceMinor > maxPriceMinor`.
   * Implemented in FLT-11.
   */
  search(query: OneWaySearchQuery): Promise<Paginated<FlightSearchItem>>;
  search(query: RoundTripSearchQuery): Promise<RoundTripSearchResult>;
  search(
    query: SearchFlightsQuery,
  ): Promise<Paginated<FlightSearchItem> | RoundTripSearchResult>;
  search(
    query: SearchFlightsQuery,
  ): Promise<Paginated<FlightSearchItem> | RoundTripSearchResult> {
    void query;
    throw new NotImplementedException('search: implemented in FLT-11');
  }

  /** One airline by ID, or `null` (FLT-01, ACC-13). */
  getAirline(airlineId: string): Promise<AirlineView | null> {
    return this.airlines.getAirline(airlineId);
  }

  /**
   * Activate or deactivate an airline (ACC-15) and return it. Idempotent.
   * Throws 404 `NOT_FOUND` if it doesn't exist. Admin calls this via ACC-15.
   */
  setAirlineActive(airlineId: string, isActive: boolean): Promise<AirlineView> {
    return this.airlines.setAirlineActive(airlineId, isActive);
  }

  private objectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw this.notFound();
    return new Types.ObjectId(id);
  }

  private flightObjectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw this.flightNotFound();
    return new Types.ObjectId(id);
  }

  private toManagementView(
    flight: FlightRecord,
    departureAirport: AirportView,
    arrivalAirport: AirportView,
  ): FlightManagementView {
    return {
      id: flight._id.toString(),
      airlineId: flight.airlineId.toString(),
      flightNumber: flight.flightNumber,
      departureAirportId: flight.departureAirportId,
      arrivalAirportId: flight.arrivalAirportId,
      departureAt: new Date(flight.departureAt),
      arrivalAt: new Date(flight.arrivalAt),
      departureLocalDate: flight.departureLocalDate,
      durationMinutes: flight.durationMinutes,
      status: flight.status,
      hasBookings: flight.hasBookings,
      cabins: flight.cabins.map((cabin) => ({
        id: cabin._id.toString(),
        cabinClass: cabin.cabinClass,
        totalSeats: cabin.totalSeats,
        availableSeats: cabin.availableSeats,
        heldSeats: cabin.heldSeats,
        bookedSeats: cabin.bookedSeats,
        priceMinor: cabin.priceMinor,
        freeBags: cabin.freeBags,
        maxBagWeightKg: cabin.maxBagWeightKg,
      })),
      departureTimeZone: departureAirport.timeZone,
      arrivalTimeZone: arrivalAirport.timeZone,
    };
  }

  private invalidField(field: string, message: string): BadRequestException {
    return new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Invalid flight',
      details: [{ field, message }],
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Airline not found',
    });
  }

  private flightNotFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Flight not found',
    });
  }

  private flightNotScheduled(): ConflictException {
    return new ConflictException({
      code: ErrorCode.InvalidStatusTransition,
      message: 'Only scheduled flights can be edited',
    });
  }

  private cabinAlreadyExists(): ConflictException {
    return new ConflictException({
      code: ErrorCode.Conflict,
      message: 'This flight already has that cabin class',
    });
  }
}
