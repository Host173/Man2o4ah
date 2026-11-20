import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { CabinClass } from '../../common/database/cabin-class.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { toPage } from '../../common/pagination/paginated.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import type { AirportView } from '../reference-data/reference-data.types.js';
import { convertFlightTimes } from './flight-time.js';
import { AirlinesService } from './airlines.service.js';
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
 * What other modules may ask of flights (CTR-02). Seat counters are never
 * changed here: that is `SeatInventory`. Getters return `null`, or leave the
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
    this.validateCabinInput(input);
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

    const updated = await this.flightModel
      .findOneAndUpdate(
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
        { returnDocument: 'after', runValidators: true },
      )
      .lean<FlightRecord>()
      .exec();

    if (!updated) {
      const current = await this.flightModel
        .findOne(filter)
        .lean<FlightRecord>()
        .exec();
      if (!current) throw this.flightNotFound();
      if (current.status !== FlightStatus.SCHEDULED) {
        throw this.flightNotScheduled();
      }
      if (
        current.cabins.some((cabin) => cabin.cabinClass === input.cabinClass)
      ) {
        throw this.cabinAlreadyExists();
      }
      throw new ConflictException({
        code: ErrorCode.Conflict,
        message: 'Flight changed before the cabin could be added',
      });
    }

    return this.toManagementView(updated, departureAirport, arrivalAirport);
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

  private validateCabinInput(input: AddCabinInput): void {
    if (!Object.values(CabinClass).includes(input.cabinClass)) {
      throw this.invalidField('cabinClass', 'is not a supported cabin class');
    }
    if (!Number.isSafeInteger(input.totalSeats) || input.totalSeats < 1) {
      throw this.invalidField('totalSeats', 'must be a positive safe integer');
    }
    if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 1) {
      throw this.invalidField('priceMinor', 'must be a positive safe integer');
    }
    if (!Number.isSafeInteger(input.freeBags) || input.freeBags < 0) {
      throw this.invalidField(
        'freeBags',
        'must be a non-negative safe integer',
      );
    }
    if (
      typeof input.maxBagWeightKg !== 'number' ||
      !Number.isFinite(input.maxBagWeightKg) ||
      input.maxBagWeightKg <= 0
    ) {
      throw this.invalidField('maxBagWeightKg', 'must be a positive number');
    }
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
