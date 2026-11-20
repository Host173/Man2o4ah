import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { toPage } from '../../common/pagination/paginated.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import type { AirportView } from '../reference-data/reference-data.types.js';
import { convertFlightTimes, formatLocalDateTime } from './flight-time.js';
import { AirlinesService } from './airlines.service.js';
import { validateCabinInput } from './cabin-input.js';
import { SeatInventory } from './seat-inventory.js';
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

  /** Marks scheduled flights departed once their UTC departure time passes (FLT-30). */
  @Cron('* * * * *', { name: 'mark-flights-departed', timeZone: 'UTC' })
  async markFlightsDeparted(now = new Date()): Promise<number> {
    const result = await this.flightModel
      .updateMany(
        {
          status: FlightStatus.SCHEDULED,
          departureAt: { $lte: now },
        },
        { $set: { status: FlightStatus.DEPARTED } },
      )
      .exec();
    return result.modifiedCount;
  }

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
   * Cancel a scheduled flight owned by the moderator (FLT-06). The conditional
   * update is atomic; the cancellation event is emitted only after it succeeds.
   */
  async cancelFlight(
    flightId: string,
    moderatorAirlineId: string | undefined,
  ): Promise<void> {
    if (
      !Types.ObjectId.isValid(flightId) ||
      !moderatorAirlineId ||
      !Types.ObjectId.isValid(moderatorAirlineId)
    ) {
      throw this.flightNotFound();
    }

    const id = new Types.ObjectId(flightId);
    const airlineId = new Types.ObjectId(moderatorAirlineId);
    const flight = await this.flightModel
      .findOneAndUpdate(
        { _id: id, airlineId, status: FlightStatus.SCHEDULED },
        {
          $set: {
            status: FlightStatus.CANCELLED,
            cancelledAt: new Date(),
          },
        },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<FlightRecord>()
      .exec();

    if (!flight) {
      const ownedFlight = await this.flightModel
        .exists({ _id: id, airlineId })
        .exec();
      if (!ownedFlight) throw this.flightNotFound();
      throw new ConflictException({
        code: ErrorCode.InvalidStatusTransition,
        message: 'Only scheduled flights can be cancelled',
      });
    }

    this.events.emit(Events.FlightCancelled, {
      flightId: flight._id.toString(),
    });
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
        const airportsChanged =
          departureAirportId !== flight.departureAirportId ||
          arrivalAirportId !== flight.arrivalAirportId;
        const result = await this.flightModel
          .updateOne(
            {
              ...filter,
              status: FlightStatus.SCHEDULED,
              // A hold placed after the read above must still lock the airports.
              ...(airportsChanged ? { hasBookings: false } : {}),
            },
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
        // matchedCount: re-sending the current values modifies nothing but is valid.
        if (result.matchedCount !== 1) {
          if (airportsChanged) {
            throw new ConflictException({
              code: ErrorCode.Conflict,
              message:
                'Airports cannot be changed after a booking or seat hold',
            });
          }
          throw this.flightNotFound();
        }
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
          if (result.matchedCount !== 1) throw this.flightNotFound();
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
   * ask `checkBookable` whether they can be booked. Returns airport IANA zones
   * for booking-facing and e-ticket local-time display (FLT-17).
   */
  async getFlightsForBooking(
    flightIds: string[],
  ): Promise<Map<string, FlightWithAirline>> {
    const objectIds = flightIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return new Map();
    const flights = await this.flightModel
      .find({ _id: { $in: objectIds } })
      .lean<FlightRecord[]>()
      .exec();
    if (flights.length === 0) return new Map();
    const airlineIds = [
      ...new Set(flights.map((flight) => flight.airlineId.toHexString())),
    ].map((id) => new Types.ObjectId(id));
    const airlines = await this.airlineModel
      .find({ _id: { $in: airlineIds } })
      .lean<(Airline & { _id: Types.ObjectId })[]>()
      .exec();
    const airlinesById = new Map(
      airlines.map((airline) => [airline._id.toHexString(), airline]),
    );
    const airportCodes = [
      ...new Set(
        flights.flatMap((flight) => [
          flight.departureAirportId,
          flight.arrivalAirportId,
        ]),
      ),
    ];
    const airports = await this.referenceData.getAirports(airportCodes);
    const result = new Map<string, FlightWithAirline>();
    for (const flight of flights) {
      const airline = airlinesById.get(flight.airlineId.toHexString());
      const departureAirport = airports.get(flight.departureAirportId);
      const arrivalAirport = airports.get(flight.arrivalAirportId);
      if (!airline || !departureAirport || !arrivalAirport) continue;
      result.set(flight._id.toHexString(), {
        flight: this.toFlightViewWithZones(
          flight,
          departureAirport.timeZone,
          arrivalAirport.timeZone,
        ),
        airline: this.airlineView(airline),
      });
    }
    return result;
  }

  /**
   * Public flight details (FLT-17): flight, airline, local UTC-derived times,
   * all cabins, remaining seats and baggage/cancellation policies.
   */
  async getFlightDetails(
    flightId: string,
  ): Promise<{ flight: FlightManagementView; airline: AirlineView }> {
    const flightObjectId = this.flightObjectId(flightId);
    const flight = await this.flightModel
      .findById(flightObjectId)
      .lean<FlightRecord>()
      .exec();
    if (!flight) throw this.flightNotFound();
    const airline = await this.airlineModel
      .findById(flight.airlineId)
      .lean<Airline & { _id: Types.ObjectId }>()
      .exec();
    if (!airline) throw this.flightNotFound();
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
    return {
      flight: this.toManagementView(flight, departureAirport, arrivalAirport),
      airline: this.airlineView(airline),
    };
  }

  /**
   * Can `seats` seats of this cabin be booked now? Airline active, flight `scheduled`,
   * departure in the future and enough available seats. The seat check is advisory:
   * only `SeatInventory.hold` is atomic. Never throws for a business reason. Implemented in FLT-17.
   */
  async checkBookable(
    flightId: string,
    cabinId: string,
    seats: number,
  ): Promise<BookabilityResult> {
    if (!Types.ObjectId.isValid(flightId) || !Types.ObjectId.isValid(cabinId)) {
      return { bookable: false, reason: 'flight_not_found' };
    }
    if (!Number.isSafeInteger(seats) || seats < 1) {
      return { bookable: false, reason: 'not_enough_seats' };
    }
    const flight = await this.flightModel
      .findById(new Types.ObjectId(flightId))
      .lean<FlightRecord>()
      .exec();
    if (!flight) return { bookable: false, reason: 'flight_not_found' };
    const cabin = flight.cabins.find((item) =>
      item._id.equals(new Types.ObjectId(cabinId)),
    );
    if (!cabin) return { bookable: false, reason: 'cabin_not_found' };
    const airline = await this.airlineModel
      .findById(flight.airlineId)
      .select({ isActive: 1 })
      .lean()
      .exec();
    if (!airline?.isActive)
      return { bookable: false, reason: 'airline_inactive' };
    if (flight.status !== FlightStatus.SCHEDULED) {
      return { bookable: false, reason: 'flight_not_scheduled' };
    }
    if (flight.departureAt.getTime() <= Date.now()) {
      return { bookable: false, reason: 'departure_passed' };
    }
    if (cabin.availableSeats < seats) {
      return { bookable: false, reason: 'not_enough_seats' };
    }
    return { bookable: true };
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
  async search(
    query: SearchFlightsQuery,
  ): Promise<Paginated<FlightSearchItem> | RoundTripSearchResult> {
    this.validateSearch(query);
    if (query.returnDate !== undefined) {
      const [outbound, inbound] = await Promise.all([
        this.searchLeg(query, query.from, query.to, query.date),
        this.searchLeg(query, query.to, query.from, query.returnDate),
      ]);
      return { outbound, inbound };
    }
    return this.searchLeg(query, query.from, query.to, query.date);
  }

  private validateSearch(query: SearchFlightsQuery): void {
    query.from = query.from.trim().toUpperCase();
    query.to = query.to.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(query.from)) {
      throw this.invalidField('from', 'must be a 3-letter airport code');
    }
    if (!/^[A-Z]{3}$/.test(query.to)) {
      throw this.invalidField('to', 'must be a 3-letter airport code');
    }
    if (query.from === query.to) {
      throw this.invalidField('to', 'must differ from from');
    }
    this.validateLocalDate(query.date, 'date');
    if (!Number.isInteger(query.adults) || query.adults < 1) {
      throw this.invalidField('adults', 'must be a positive integer');
    }
    if (
      !Number.isInteger(query.children) ||
      query.children < 0 ||
      !Number.isInteger(query.infants) ||
      query.infants < 0
    ) {
      throw this.invalidField(
        'passengers',
        'children and infants must be non-negative integers',
      );
    }
    if (query.infants > query.adults) {
      throw this.invalidField(
        'infants',
        'must not exceed the number of adults',
      );
    }
    if (
      query.minPriceMinor !== undefined &&
      (!Number.isSafeInteger(query.minPriceMinor) || query.minPriceMinor < 0)
    ) {
      throw this.invalidField(
        'minPriceMinor',
        'must be a non-negative safe integer',
      );
    }
    if (
      query.maxPriceMinor !== undefined &&
      (!Number.isSafeInteger(query.maxPriceMinor) || query.maxPriceMinor < 0)
    ) {
      throw this.invalidField(
        'maxPriceMinor',
        'must be a non-negative safe integer',
      );
    }
    if (
      query.minPriceMinor !== undefined &&
      query.maxPriceMinor !== undefined &&
      query.minPriceMinor > query.maxPriceMinor
    ) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'minPriceMinor must not be greater than maxPriceMinor',
        details: [
          {
            field: 'minPriceMinor',
            message: 'must not be greater than maxPriceMinor',
          },
        ],
      });
    }
    if (query.returnDate !== undefined) {
      this.validateLocalDate(query.returnDate, 'returnDate');
      if (query.returnDate < query.date) {
        throw this.invalidField(
          'returnDate',
          'must not be before the outbound date',
        );
      }
    }
  }

  private validateLocalDate(value: string, field: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw this.invalidField(field, 'must use YYYY-MM-DD');
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw this.invalidField(field, 'must be a valid calendar date');
    }
  }

  private async searchLeg(
    query: SearchFlightsQuery,
    from: string,
    to: string,
    date: string,
  ): Promise<Paginated<FlightSearchItem>> {
    const now = new Date();
    const seats = query.adults + query.children;
    const airlines = await this.airlineModel
      .find({ isActive: true })
      .lean()
      .exec();
    const activeAirlines = new Map(
      airlines.map((airline) => [
        (airline as Airline & { _id: Types.ObjectId })._id.toHexString(),
        airline as Airline & { _id: Types.ObjectId },
      ]),
    );
    const airports = await this.referenceData.getAirports([from, to]);
    const departureAirport = airports.get(from);
    const arrivalAirport = airports.get(to);
    if (activeAirlines.size === 0 || !departureAirport || !arrivalAirport) {
      return toPage([], 0, query.page, query.limit);
    }

    const filter = {
      departureAirportId: from,
      arrivalAirportId: to,
      departureLocalDate: date,
      status: FlightStatus.SCHEDULED,
      departureAt: { $gt: now },
      airlineId: {
        $in: [...activeAirlines.keys()].map((id) => new Types.ObjectId(id)),
      },
    };
    const flights = await this.flightModel
      .find(filter)
      .lean<FlightRecord[]>()
      .exec();
    const items: FlightSearchItem[] = [];
    for (const flight of flights) {
      const airline = activeAirlines.get(flight.airlineId.toHexString());
      if (!airline) continue;
      const matchingCabins = flight.cabins
        .filter(
          (cabin) =>
            cabin.availableSeats >= seats &&
            (query.cabinClass === undefined ||
              cabin.cabinClass === query.cabinClass) &&
            (query.minPriceMinor === undefined ||
              cabin.priceMinor >= query.minPriceMinor) &&
            (query.maxPriceMinor === undefined ||
              cabin.priceMinor <= query.maxPriceMinor),
        )
        .sort((a, b) => a.priceMinor - b.priceMinor)
        .map((cabin) => ({
          id: cabin._id.toString(),
          cabinClass: cabin.cabinClass,
          totalSeats: cabin.totalSeats,
          availableSeats: cabin.availableSeats,
          heldSeats: cabin.heldSeats,
          bookedSeats: cabin.bookedSeats,
          priceMinor: cabin.priceMinor,
          freeBags: cabin.freeBags,
          maxBagWeightKg: cabin.maxBagWeightKg,
        }));
      if (matchingCabins.length === 0) continue;
      items.push({
        flight: this.toFlightViewWithZones(
          flight,
          departureAirport.timeZone,
          arrivalAirport.timeZone,
        ),
        airline: this.airlineView(airline),
        matchingCabins,
      });
    }

    items.sort((a, b) => {
      let compared = 0;
      if (query.sortBy === 'price') {
        compared =
          a.matchingCabins[0].priceMinor - b.matchingCabins[0].priceMinor;
      } else if (query.sortBy === 'duration') {
        compared = a.flight.durationMinutes - b.flight.durationMinutes;
      } else {
        compared =
          a.flight.departureAt.getTime() - b.flight.departureAt.getTime();
      }
      return (
        compared ||
        a.flight.departureAt.getTime() - b.flight.departureAt.getTime() ||
        a.flight.id.localeCompare(b.flight.id)
      );
    });
    const start = (query.page - 1) * query.limit;
    const found = items.length;
    return toPage(
      items.slice(start, start + query.limit),
      found,
      query.page,
      query.limit,
    );
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

  private airlineView(airline: Airline & { _id: Types.ObjectId }): AirlineView {
    const logo = airline.logo
      ? {
          id:
            (
              airline.logo as unknown as { _id?: Types.ObjectId }
            )._id?.toString() ?? airline.logo.key,
          url: `/uploads/${airline.logo.key}`,
        }
      : undefined;
    return {
      id: airline._id.toHexString(),
      name: airline.name,
      code: airline.code,
      isActive: airline.isActive,
      ...(logo ? { logo } : {}),
      baggagePolicy: {
        extraBagPriceMinor: airline.baggagePolicy.extraBagPriceMinor,
        maxExtraBagsPerPassenger:
          airline.baggagePolicy.maxExtraBagsPerPassenger,
      },
      cancellationTiers: airline.cancellationPolicy.tiers.map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      })),
    };
  }

  private toFlightViewWithZones(
    flight: FlightRecord,
    departureTimeZone: string,
    arrivalTimeZone: string,
  ): FlightManagementView {
    return {
      id: flight._id.toHexString(),
      airlineId: flight.airlineId.toHexString(),
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
        id: cabin._id.toHexString(),
        cabinClass: cabin.cabinClass,
        totalSeats: cabin.totalSeats,
        availableSeats: cabin.availableSeats,
        heldSeats: cabin.heldSeats,
        bookedSeats: cabin.bookedSeats,
        priceMinor: cabin.priceMinor,
        freeBags: cabin.freeBags,
        maxBagWeightKg: cabin.maxBagWeightKg,
      })),
      departureTimeZone,
      arrivalTimeZone,
    };
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
