import { ConflictException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Types } from 'mongoose';
import { CabinClass } from '../../common/database/cabin-class.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { AirlinesService } from './airlines.service.js';
import { FlightsService } from './flights.service.js';
import { Airline } from './schemas/airline.schema.js';
import { Flight } from './schemas/flight.schema.js';
import { SeatInventory } from './seat-inventory.js';

describe('FlightsService', () => {
  let moduleRef: TestingModule | undefined;
  let service: FlightsService;

  const airlineProfiles = {
    getAirline: vi.fn(),
    setAirlineActive: vi.fn(),
  };

  beforeAll(async () => {
    const testModule = await Test.createTestingModule({
      providers: [
        FlightsService,
        { provide: AirlinesService, useValue: airlineProfiles },
        { provide: getModelToken(Flight.name), useValue: {} },
        { provide: getModelToken(Airline.name), useValue: {} },
        { provide: ReferenceDataService, useValue: {} },
        { provide: getConnectionToken(), useValue: {} },
        { provide: SeatInventory, useValue: {} },
        { provide: AppEvents, useValue: { emit: vi.fn() } },
      ],
    }).compile();

    moduleRef = testModule;
    service = testModule.get(FlightsService);
  });

  describe('FlightsService cabin creation (FLT-04)', () => {
    const flightId = new Types.ObjectId();
    const airlineId = new Types.ObjectId();
    const input = {
      cabinClass: CabinClass.BUSINESS,
      totalSeats: 7,
      priceMinor: 75000,
      freeBags: 2,
      maxBagWeightKg: 32,
    };
    const flight = {
      _id: flightId,
      airlineId,
      flightNumber: 'MS 123',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureAt: new Date('2027-03-14T08:00:00.000Z'),
      arrivalAt: new Date('2027-03-14T12:00:00.000Z'),
      departureLocalDate: '2027-03-14',
      durationMinutes: 240,
      status: 'scheduled',
      hasBookings: false,
      cabins: [],
    };
    const updated = {
      ...flight,
      cabins: [
        {
          _id: new Types.ObjectId(),
          ...input,
          availableSeats: 7,
          heldSeats: 0,
          bookedSeats: 0,
        },
      ],
    };
    const session = {
      withTransaction: vi.fn(async (callback: () => Promise<unknown>) =>
        callback(),
      ),
      endSession: vi.fn(),
    };
    const connection = { startSession: vi.fn(async () => session) };
    const inventory = { addCabin: vi.fn() };
    const query = {
      session: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn(),
    };
    const model = { findOne: vi.fn(() => query) };
    const reference = {
      getAirports: vi.fn(
        async () =>
          new Map([
            ['CAI', { timeZone: 'Africa/Cairo' }],
            ['DXB', { timeZone: 'Asia/Dubai' }],
          ]),
      ),
    };
    let moduleRef: TestingModule;
    let service: FlightsService;

    beforeEach(async () => {
      vi.clearAllMocks();
      query.exec.mockReset();
      query.exec.mockResolvedValueOnce(flight).mockResolvedValue(updated);
      inventory.addCabin.mockReset();
      inventory.addCabin.mockResolvedValue(undefined);
      moduleRef = await Test.createTestingModule({
        providers: [
          FlightsService,
          { provide: AirlinesService, useValue: {} },
          { provide: getModelToken(Flight.name), useValue: model },
          { provide: getModelToken(Airline.name), useValue: {} },
          { provide: ReferenceDataService, useValue: reference },
          { provide: getConnectionToken(), useValue: connection },
          { provide: SeatInventory, useValue: inventory },
          { provide: AppEvents, useValue: { emit: vi.fn() } },
        ],
      }).compile();
      service = moduleRef.get(FlightsService);
    });

    afterEach(() => moduleRef.close());

    it('initializes through SeatInventory in a transaction and returns a plain view', async () => {
      const result = await service.addCabin(
        flightId.toHexString(),
        input,
        airlineId.toHexString(),
      );

      expect(inventory.addCabin).toHaveBeenCalledWith(
        flightId.toHexString(),
        input,
        airlineId.toHexString(),
        { session },
      );
      expect(session.withTransaction).toHaveBeenCalledOnce();
      expect(query.session).toHaveBeenCalledWith(session);
      expect(session.endSession).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        id: flightId.toHexString(),
        airlineId: airlineId.toHexString(),
        departureTimeZone: 'Africa/Cairo',
        arrivalTimeZone: 'Asia/Dubai',
        cabins: [
          {
            id: updated.cabins[0]!._id.toHexString(),
            ...input,
            availableSeats: 7,
            heldSeats: 0,
            bookedSeats: 0,
          },
        ],
      });
    });

    it('propagates an atomic conflict and always closes the session', async () => {
      const conflict = new ConflictException({
        code: ErrorCode.Conflict,
        message: 'Cabin class already exists',
      });
      inventory.addCabin.mockRejectedValue(conflict);

      await expect(
        service.addCabin(
          flightId.toHexString(),
          input,
          airlineId.toHexString(),
        ),
      ).rejects.toBe(conflict);
      expect(session.endSession).toHaveBeenCalledOnce();
    });

    it.each([
      ['totalSeats', 0],
      ['priceMinor', Number.MAX_SAFE_INTEGER + 1],
      ['freeBags', -1],
      ['maxBagWeightKg', Number.POSITIVE_INFINITY],
    ])(
      'rejects invalid %s before accessing inventory',
      async (field, value) => {
        await expect(
          service.addCabin(
            flightId.toHexString(),
            { ...input, [field]: value },
            airlineId.toHexString(),
          ),
        ).rejects.toMatchObject({
          status: 400,
          response: { code: ErrorCode.ValidationFailed, details: [{ field }] },
        });
        expect(model.findOne).not.toHaveBeenCalled();
        expect(inventory.addCabin).not.toHaveBeenCalled();
      },
    );

    it('scopes the lookup to the moderator airline and rejects a missing flight', async () => {
      query.exec.mockReset().mockResolvedValue(null);

      await expect(
        service.addCabin(
          flightId.toHexString(),
          input,
          airlineId.toHexString(),
        ),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: ErrorCode.NotFound },
      });
      expect(model.findOne).toHaveBeenCalledWith({ _id: flightId, airlineId });
      expect(inventory.addCabin).not.toHaveBeenCalled();
    });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('delegates public airline operations to the profile service', async () => {
    airlineProfiles.getAirline.mockResolvedValue(null);
    airlineProfiles.setAirlineActive.mockResolvedValue({ id: 'a1' });

    await expect(service.getAirline('a1')).resolves.toBeNull();
    await expect(service.setAirlineActive('a1', false)).resolves.toMatchObject({
      id: 'a1',
    });
    expect(airlineProfiles.getAirline).toHaveBeenCalledWith('a1');
    expect(airlineProfiles.setAirlineActive).toHaveBeenCalledWith('a1', false);
  });

  it('marks scheduled flights departed at the exact boundary and leaves other states unchanged', async () => {
    const updateMany = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    });
    const flightModel = moduleRef?.get(
      getModelToken(Flight.name),
    ) as unknown as {
      updateMany: typeof updateMany;
    };
    flightModel.updateMany = updateMany;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T12:00:00.000Z'));

    await expect(service.markFlightsDeparted()).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith(
      {
        status: 'scheduled',
        departureAt: { $lte: new Date('2026-11-20T12:00:00.000Z') },
      },
      { $set: { status: 'departed' } },
    );
    vi.useRealTimers();
  });
});
