import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { FakeAccountsService } from '../../../test/fakes/accounts.fake.js';
import { FakeFlightBookingsService } from '../../../test/fakes/flight-bookings.fake.js';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakeHotelBookingsService } from '../../../test/fakes/hotel-bookings.fake.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  ProviderType,
  UserRole,
  UserStatus,
} from '../accounts/schemas/user.schema.js';
import { AuditAction } from '../audit/schemas/audit-log.schema.js';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service.js';
import type { FlightBookingAdminView } from '../flight-bookings/flight-bookings.types.js';
import { FlightsService } from '../flights/flights.service.js';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service.js';
import type { HotelReservationAdminView } from '../hotel-bookings/hotel-bookings.types.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { AdminModule } from './admin.module.js';
import { AdminService } from './admin.service.js';
import { AdminProviderParamsDto } from './dto/admin-provider-params.dto.js';
import { CreateModeratorDto } from './dto/create-moderator.dto.js';
import { ListAdminAccountsQueryDto } from './dto/list-admin-accounts-query.dto.js';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto.js';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto.js';

function createAdminService(
  flightBookings: FakeFlightBookingsService = new FakeFlightBookingsService([]),
  hotelBookings: FakeHotelBookingsService = new FakeHotelBookingsService([]),
  deps: {
    accounts?: FakeAccountsService;
    flights?: FakeFlightsService;
    hotels?: FakeHotelsService;
    events?: FakeEvents;
  } = {},
): AdminService {
  return new AdminService(
    flightBookings as unknown as FlightBookingsService,
    hotelBookings as unknown as HotelBookingsService,
    (deps.accounts ?? new FakeAccountsService()) as unknown as AccountsService,
    (deps.flights ?? new FakeFlightsService()) as unknown as FlightsService,
    (deps.hotels ?? new FakeHotelsService()) as unknown as HotelsService,
    (deps.events ?? new FakeEvents()) as unknown as AppEvents,
  );
}

function flightView(
  overrides: Partial<FlightBookingAdminView> = {},
): FlightBookingAdminView {
  return {
    bookingType: BookingType.FLIGHT,
    bookingId: '6736f0b2c5a1b2c3d4e5f701',
    reference: 'FB100001',
    userId: '6736f0b2c5a1b2c3d4e5f801',
    providerId: '6736f0b2c5a1b2c3d4e5f901',
    startAt: new Date('2026-12-01T08:00:00.000Z'),
    endAt: new Date('2026-12-01T11:30:00.000Z'),
    totalMinor: 25000,
    currency: 'USD',
    status: 'confirmed',
    createdAt: new Date('2026-11-10T10:00:00.000Z'),
    ...overrides,
  };
}

function hotelView(
  overrides: Partial<HotelReservationAdminView> = {},
): HotelReservationAdminView {
  return {
    bookingType: BookingType.HOTEL,
    bookingId: '6736f0b2c5a1b2c3d4e5f702',
    reference: 'HB100001',
    userId: '6736f0b2c5a1b2c3d4e5f802',
    providerId: '6736f0b2c5a1b2c3d4e5f902',
    startAt: new Date('2026-12-05T15:00:00.000Z'),
    endAt: new Date('2026-12-08T11:00:00.000Z'),
    totalMinor: 48000,
    currency: 'USD',
    status: 'confirmed',
    createdAt: new Date('2026-11-11T10:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminService', () => {
  it(
    'provides and exports AdminService from AdminModule',
    async () => {
      // The real module graph on the in-memory database: booking modules
      // inject the Mongoose connection (transactions), so models alone
      // aren't enough to build AdminModule.
      const t = await createTestApp({ imports: [AdminModule] });
      try {
        expect(t.moduleRef.get(AdminService)).toBeInstanceOf(AdminService);
      } finally {
        await t.close();
      }
    },
    HOOK_TIMEOUT,
  );

  it('returns empty page when no bookings exist', async () => {
    const service = createAdminService(
      new FakeFlightBookingsService([]),
      new FakeHotelBookingsService([]),
    );

    const res = await service.listBookings(new ListAdminBookingsQueryDto());
    expect(res).toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it("keeps each service's order on ties", async () => {
    const sameTs = new Date('2026-11-12T12:00:00.000Z');
    const flights = [
      flightView({ bookingId: 'f-b', createdAt: sameTs }),
      flightView({
        bookingId: 'f-old',
        createdAt: new Date('2026-11-09T12:00:00.000Z'),
      }),
    ];
    const hotels = [
      hotelView({ bookingId: 'h-a', createdAt: sameTs }),
      hotelView({
        bookingId: 'h-new',
        createdAt: new Date('2026-11-13T12:00:00.000Z'),
      }),
    ];
    const service = createAdminService(
      new FakeFlightBookingsService(flights),
      new FakeHotelBookingsService(hotels),
    );

    const page1 = await service.listBookings(
      plainToInstance(ListAdminBookingsQueryDto, { page: 1, limit: 2 }),
    );
    const page2 = await service.listBookings(
      plainToInstance(ListAdminBookingsQueryDto, { page: 2, limit: 2 }),
    );

    expect(page1.items.map((item) => item.bookingId)).toEqual(['h-new', 'f-b']);
    expect(page2.items.map((item) => item.bookingId)).toEqual(['h-a', 'f-old']);
    expect(page1.total).toBe(4);
    expect(page1.totalPages).toBe(2);
  });

  it('rejects from > to with VALIDATION_FAILED details', async () => {
    const service = createAdminService(
      new FakeFlightBookingsService([]),
      new FakeHotelBookingsService([]),
    );

    await expect(
      service.listBookings(
        plainToInstance(ListAdminBookingsQueryDto, {
          from: '2026-11-20',
          to: '2026-11-10',
        }),
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'from' }],
      },
    });
  });

  it('strips unexpected fields beyond the CTR-04 admin booking view contract', async () => {
    const leakyFlight = {
      ...flightView(),
      passengerEmail: 'secret@example.com',
      paymentIntentId: 'pi_secret',
    } as FlightBookingAdminView;
    const service = createAdminService(
      new FakeFlightBookingsService([leakyFlight]),
      new FakeHotelBookingsService([]),
    );

    const res = await service.listBookings(
      plainToInstance(ListAdminBookingsQueryDto, { type: BookingType.FLIGHT }),
    );
    expect(res.items[0]).not.toHaveProperty('passengerEmail');
    expect(res.items[0]).not.toHaveProperty('paymentIntentId');
  });

  it('validates ListAdminBookingsQueryDto query params', async () => {
    const valid = plainToInstance(ListAdminBookingsQueryDto, {
      type: 'flight',
      status: 'confirmed',
      from: '2026-11-01',
      to: '2026-11-30',
      page: 1,
      limit: 50,
    });
    expect(await validate(valid)).toHaveLength(0);

    const invalidCases = [
      { type: 'cruise' },
      { status: 'archived' },
      { from: '2026-11-1' },
      { to: '2026-02-29' },
      { limit: 51 },
      { page: 0 },
      { page: 10001 },
      { page: 1e300 },
      { page: 'abc' },
    ];
    for (const raw of invalidCases) {
      const dto = plainToInstance(ListAdminBookingsQueryDto, raw);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    }

    const validBoundary = plainToInstance(ListAdminBookingsQueryDto, {
      page: 10000,
      limit: 1,
    });
    expect(await validate(validBoundary)).toHaveLength(0);
  });

  it('keeps service order across limit=1 pages when multiple flights share createdAt', async () => {
    const tiedAt = new Date('2026-11-11T12:00:00.000Z');
    const flights = [
      flightView({ bookingId: 'f-c', createdAt: tiedAt }),
      flightView({ bookingId: 'f-b', createdAt: tiedAt }),
      flightView({ bookingId: 'f-a', createdAt: tiedAt }),
    ];
    const hotels = [
      hotelView({
        bookingId: 'h-2',
        createdAt: new Date('2026-11-12T12:00:00.000Z'),
      }),
      hotelView({
        bookingId: 'h-1',
        createdAt: new Date('2026-11-10T12:00:00.000Z'),
      }),
    ];
    const service = createAdminService(
      new FakeFlightBookingsService(flights),
      new FakeHotelBookingsService(hotels),
    );

    const ids: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const res = await service.listBookings(
        plainToInstance(ListAdminBookingsQueryDto, { page, limit: 1 }),
      );
      expect(res.items).toHaveLength(1);
      ids.push(res.items[0].bookingId);
    }
    expect(ids).toEqual(['h-2', 'f-c', 'f-b', 'f-a', 'h-1']);

    const page6 = await service.listBookings(
      plainToInstance(ListAdminBookingsQueryDto, { page: 6, limit: 1 }),
    );
    expect(page6.items).toEqual([]);
  });

  it('caps page * limit at 10000 without calling the booking services when exceeded', async () => {
    const fakeFlights = new FakeFlightBookingsService([]);
    const fakeHotels = new FakeHotelBookingsService([]);
    const flightsSpy = vi.spyOn(fakeFlights, 'listForAdmin');
    const hotelsSpy = vi.spyOn(fakeHotels, 'listForAdmin');
    const service = createAdminService(fakeFlights, fakeHotels);

    await expect(
      service.listBookings(
        plainToInstance(ListAdminBookingsQueryDto, { page: 200, limit: 50 }),
      ),
    ).resolves.toMatchObject({ page: 200, limit: 50, items: [] });

    await expect(
      service.listBookings(
        plainToInstance(ListAdminBookingsQueryDto, { page: 10000, limit: 1 }),
      ),
    ).resolves.toMatchObject({ page: 10000, limit: 1, items: [] });

    flightsSpy.mockClear();
    hotelsSpy.mockClear();

    for (const [page, limit] of [
      [201, 50],
      [10001, 1],
      [1000000, 50],
      [1e300, 1],
    ] as const) {
      await expect(
        service.listBookings(
          plainToInstance(ListAdminBookingsQueryDto, { page, limit }),
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'page' }],
        },
      });
      expect(flightsSpy).not.toHaveBeenCalled();
      expect(hotelsSpy).not.toHaveBeenCalled();
    }
  });

  it('clamps merged totalPages to reachable 10000-row depth without altering real total', async () => {
    const baseMs = Date.parse('2026-11-18T00:00:00.000Z');
    const flights10k = Array.from({ length: 10_000 }, (_, idx) =>
      flightView({
        bookingId: `f-${idx}`,
        createdAt: new Date(baseMs - idx * 2_000),
      }),
    );
    const hotels10k = Array.from({ length: 10_000 }, (_, idx) =>
      hotelView({
        bookingId: `h-${idx}`,
        createdAt: new Date(baseMs - (idx * 2 + 1) * 1_000),
      }),
    );
    const fakeFlights = new FakeFlightBookingsService(flights10k);
    const fakeHotels = new FakeHotelBookingsService(hotels10k);
    const flightsSpy = vi.spyOn(fakeFlights, 'listForAdmin');
    const hotelsSpy = vi.spyOn(fakeHotels, 'listForAdmin');
    const service = createAdminService(fakeFlights, fakeHotels);

    for (const [limit, expectedTotalPages] of [
      [50, 200],
      [1, 10_000],
      [7, 1428],
    ] as const) {
      const lastPageRes = await service.listBookings(
        plainToInstance(ListAdminBookingsQueryDto, {
          page: expectedTotalPages,
          limit,
        }),
      );
      expect(lastPageRes.total).toBe(20_000);
      expect(lastPageRes.totalPages).toBe(expectedTotalPages);
      expect(lastPageRes.items).toHaveLength(limit);

      flightsSpy.mockClear();
      hotelsSpy.mockClear();
      await expect(
        service.listBookings(
          plainToInstance(ListAdminBookingsQueryDto, {
            page: expectedTotalPages + 1,
            limit,
          }),
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'page' }],
        },
      });
      expect(flightsSpy).not.toHaveBeenCalled();
      expect(hotelsSpy).not.toHaveBeenCalled();
    }

    const smallService = createAdminService(
      new FakeFlightBookingsService(flights10k.slice(0, 60)),
      new FakeHotelBookingsService(hotels10k.slice(0, 60)),
    );
    const smallLast = await smallService.listBookings(
      plainToInstance(ListAdminBookingsQueryDto, { page: 3, limit: 50 }),
    );
    expect(smallLast.total).toBe(120);
    expect(smallLast.totalPages).toBe(3);
    expect(smallLast.items).toHaveLength(20);

    const smallBeyond = await smallService.listBookings(
      plainToInstance(ListAdminBookingsQueryDto, { page: 4, limit: 50 }),
    );
    expect(smallBeyond.total).toBe(120);
    expect(smallBeyond.totalPages).toBe(3);
    expect(smallBeyond.items).toEqual([]);
  });

  it('allows deep pages without clamping totalPages when filtered by type', async () => {
    const baseMs = Date.parse('2026-11-18T00:00:00.000Z');
    const flights20k = Array.from({ length: 20_000 }, (_, idx) =>
      flightView({
        bookingId: `f-${idx}`,
        createdAt: new Date(baseMs - idx * 1_000),
      }),
    );
    const hotels20k = Array.from({ length: 20_000 }, (_, idx) =>
      hotelView({
        bookingId: `h-${idx}`,
        createdAt: new Date(baseMs - idx * 1_000),
      }),
    );
    const fakeFlights = new FakeFlightBookingsService(flights20k);
    const fakeHotels = new FakeHotelBookingsService(hotels20k);
    const flightsSpy = vi.spyOn(fakeFlights, 'listForAdmin');
    const hotelsSpy = vi.spyOn(fakeHotels, 'listForAdmin');
    const service = createAdminService(fakeFlights, fakeHotels);

    const flightRes = await service.listBookings(
      plainToInstance(ListAdminBookingsQueryDto, {
        type: BookingType.FLIGHT,
        page: 201,
        limit: 50,
      }),
    );
    expect(flightRes.total).toBe(20_000);
    expect(flightRes.totalPages).toBe(400);
    expect(flightRes.items).toHaveLength(50);
    expect(flightsSpy).toHaveBeenCalledTimes(1);
    expect(flightsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ page: 201, limit: 50 }),
    );
    expect(hotelsSpy).not.toHaveBeenCalled();

    flightsSpy.mockClear();
    hotelsSpy.mockClear();

    const hotelRes = await service.listBookings(
      plainToInstance(ListAdminBookingsQueryDto, {
        type: BookingType.HOTEL,
        page: 201,
        limit: 50,
      }),
    );
    expect(hotelRes.total).toBe(20_000);
    expect(hotelRes.totalPages).toBe(400);
    expect(hotelRes.items).toHaveLength(50);
    expect(hotelsSpy).toHaveBeenCalledTimes(1);
    expect(hotelsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ page: 201, limit: 50 }),
    );
    expect(flightsSpy).not.toHaveBeenCalled();

    for (const type of [undefined, BookingType.FLIGHT, BookingType.HOTEL]) {
      for (const page of [10_001, 1e300]) {
        const dto = plainToInstance(ListAdminBookingsQueryDto, {
          ...(type !== undefined ? { type } : {}),
          page,
        });
        const errors = await validate(dto);
        expect(errors.map((err) => err.property)).toContain('page');
      }
    }
  });

  it('delegates listAccounts cleanly, strips unexpected fields, and validates role/status on direct calls (ACC-14)', async () => {
    const accounts = new FakeAccountsService([
      {
        id: '6736f0b2c5a1b2c3d4e50001',
        name: 'Aisha Al Rawahi',
        email: 'aisha@example.com',
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        mustChangePassword: true,
        temporaryPassword: 'Secret123',
        sessionsRevoked: 2,
      },
    ]);
    const service = createAdminService(undefined, undefined, { accounts });

    const page = await service.listAccounts(
      plainToInstance(ListAdminAccountsQueryDto, { q: '  aisha  ' }),
    );
    expect(page.total).toBe(1);
    expect(page.items[0]).not.toHaveProperty('mustChangePassword');
    expect(page.items[0]).not.toHaveProperty('temporaryPassword');
    expect(page.items[0]).not.toHaveProperty('sessionsRevoked');

    await expect(
      service.listAccounts(
        Object.assign(new ListAdminAccountsQueryDto(), {
          role: 'superadmin' as unknown as UserRole,
        }),
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'role' }],
      },
    });

    await expect(
      service.listAccounts(
        Object.assign(new ListAdminAccountsQueryDto(), {
          status: 'deleted' as unknown as UserStatus,
        }),
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'status' }],
      },
    });
  });

  it('verifies providers and validates inputs in createModerator, resetUserPassword, suspendAccount, and reactivateAccount', async () => {
    const adminId = '6736f0b2c5a1b2c3d4e59999';
    const airlineId = '6736f0b2c5a1b2c3d4e51001';
    const hotelId = '6736f0b2c5a1b2c3d4e52001';
    const userId = '6736f0b2c5a1b2c3d4e53001';

    const flightsData = new FakeFlightsData();
    flightsData.addAirline({ id: airlineId, code: 'MS', name: 'EgyptAir' });
    const flights = new FakeFlightsService(flightsData);
    const hotels = new FakeHotelsService({
      hotels: [
        {
          id: hotelId,
          name: 'Nile Hotel',
          address: '1 Nile Corniche',
          cityId: 'cairo',
          countryCode: 'EG',
          photos: [],
          amenities: [],
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationPolicy: { tiers: [] },
          isActive: false,
          ratingSummary: { average: null, count: 0 },
        },
      ],
    });
    const accounts = new FakeAccountsService([
      {
        id: userId,
        name: 'Traveler',
        email: 'traveler@example.com',
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
      },
    ]);
    const events = new FakeEvents();
    const service = createAdminService(undefined, undefined, {
      accounts,
      flights,
      hotels,
      events,
    });

    const createdAirlineMod = await service.createModerator(
      plainToInstance(CreateModeratorDto, {
        name: 'Sky Mod',
        email: 'sky@airline.example',
        role: UserRole.AIRLINE_MODERATOR,
        providerId: airlineId,
        temporaryPassword: 'Password1',
      }),
      adminId,
    );
    expect(createdAirlineMod.moderatorOf).toEqual({
      providerType: ProviderType.AIRLINE,
      providerId: airlineId,
    });

    const createdHotelMod = await service.createModerator(
      plainToInstance(CreateModeratorDto, {
        name: 'Hotel Mod',
        email: 'mod@hotel.example',
        role: UserRole.HOTEL_MODERATOR,
        providerId: hotelId,
        temporaryPassword: 'Password1',
      }),
      adminId,
    );
    expect(createdHotelMod.moderatorOf).toEqual({
      providerType: ProviderType.HOTEL,
      providerId: hotelId,
    });

    // Rejects wrong-type provider or unsupported role without creating or emitting events.
    events.clear();
    await expect(
      service.createModerator(
        plainToInstance(CreateModeratorDto, {
          name: 'Wrong',
          email: 'wrong@airline.example',
          role: UserRole.AIRLINE_MODERATOR,
          providerId: hotelId,
          temporaryPassword: 'Password1',
        }),
        adminId,
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.createModerator(
        Object.assign(new CreateModeratorDto(), {
          name: 'Bad Role',
          email: 'badrole@example.com',
          role: UserRole.USER as unknown as CreateModeratorDto['role'],
          providerId: hotelId,
          temporaryPassword: 'Password1',
        }),
        adminId,
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'role' }],
      },
    });
    expect(events.payloadsOf(Events.AdminAction)).toHaveLength(0);

    // Direct validation on resetUserPassword, suspendAccount, and reactivateAccount.
    await expect(
      service.resetUserPassword(
        'not-an-id',
        plainToInstance(ResetUserPasswordDto, {
          temporaryPassword: 'Password1',
        }),
        adminId,
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'id' }],
      },
    });
    await expect(
      service.resetUserPassword(
        userId,
        Object.assign(new ResetUserPasswordDto(), {
          temporaryPassword: 'weak',
        }),
        adminId,
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'temporaryPassword' }],
      },
    });

    await service.resetUserPassword(
      userId,
      plainToInstance(ResetUserPasswordDto, { temporaryPassword: 'Password2' }),
      adminId,
    );
    await service.suspendAccount(userId, adminId);
    await service.reactivateAccount(userId, adminId);
    await expect(service.reactivateAccount(userId, adminId)).rejects.toThrow(
      ConflictException,
    );

    expect(
      events.payloadsOf(Events.AdminAction).map((event) => event.action),
    ).toEqual([
      AuditAction.PASSWORD_RESET,
      AuditAction.ACCOUNT_SUSPENDED,
      AuditAction.ACCOUNT_REACTIVATED,
    ]);
  });

  it('validates AdminProviderParamsDto route params (ACC-15)', async () => {
    for (const type of [ProviderType.AIRLINE, ProviderType.HOTEL]) {
      const valid = plainToInstance(AdminProviderParamsDto, {
        type,
        id: '6736f0b2c5a1b2c3d4e51001',
      });
      expect(await validate(valid)).toHaveLength(0);
    }

    for (const bad of [
      { type: 'flight', id: '6736f0b2c5a1b2c3d4e51001' },
      { type: 'AIRLINE', id: '6736f0b2c5a1b2c3d4e51001' },
      { type: '', id: '6736f0b2c5a1b2c3d4e51001' },
      { type: 'airline', id: 'not-an-id' },
      { type: 'hotel', id: ' 6736f0b2c5a1b2c3d4e51001 ' },
    ]) {
      const dto = plainToInstance(AdminProviderParamsDto, bad);
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });

  it('orchestrates provider deactivation/reactivation, validates inputs, enforces lookup-before-write order, and suppresses events on failures (ACC-15)', async () => {
    const airlineId = '6736f0b2c5a1b2c3d4e51001';
    const hotelId = '6736f0b2c5a1b2c3d4e52001';
    const adminId = '6736f0b2c5a1b2c3d4e59001';
    const modA1 = '6736f0b2c5a1b2c3d4e53001';
    const modA2 = '6736f0b2c5a1b2c3d4e53002';

    const fakeAccounts = new FakeAccountsService([
      {
        id: modA1,
        name: 'Airline Mod Active',
        email: 'moda1@example.com',
        role: UserRole.AIRLINE_MODERATOR,
        status: UserStatus.ACTIVE,
        moderatorOf: {
          providerType: ProviderType.AIRLINE,
          providerId: airlineId,
        },
      },
      {
        id: modA2,
        name: 'Airline Mod Suspended',
        email: 'moda2@example.com',
        role: UserRole.AIRLINE_MODERATOR,
        status: UserStatus.SUSPENDED,
        moderatorOf: {
          providerType: ProviderType.AIRLINE,
          providerId: airlineId,
        },
      },
    ]);
    const flightsData = new FakeFlightsData();
    flightsData.addAirline({ id: airlineId, code: 'MS', name: 'EgyptAir' });
    const fakeFlights = new FakeFlightsService(flightsData);
    const fakeHotels = new FakeHotelsService({
      hotels: [
        {
          id: hotelId,
          name: 'Nile Hotel',
          address: '1 Nile St',
          cityId: 'cairo',
          countryCode: 'EG',
          photos: [],
          amenities: [],
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationPolicy: { tiers: [] },
          isActive: true,
          ratingSummary: { average: null, count: 0 },
        },
      ],
    });
    const fakeEvents = new FakeEvents();

    const getModsSpy = vi.spyOn(fakeAccounts, 'getModeratorIds');
    const setAirlineSpy = vi.spyOn(fakeFlights, 'setAirlineActive');
    const setHotelSpy = vi.spyOn(fakeHotels, 'setActive');
    const suspendSpy = vi.spyOn(fakeAccounts, 'suspend');
    const reactivateSpy = vi.spyOn(fakeAccounts, 'reactivate');

    const service = createAdminService(
      new FakeFlightBookingsService([]),
      new FakeHotelBookingsService([]),
      {
        accounts: fakeAccounts,
        flights: fakeFlights,
        hotels: fakeHotels,
        events: fakeEvents,
      },
    );

    // Direct validation on invalid type and malformed ID
    await expect(
      service.deactivateProvider('flight' as ProviderType, airlineId, adminId),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'type' }],
      },
    });
    await expect(
      service.reactivateProvider(ProviderType.HOTEL, 'bad-id', adminId),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'id' }],
      },
    });
    expect(getModsSpy).not.toHaveBeenCalled();
    expect(setAirlineSpy).not.toHaveBeenCalled();
    expect(setHotelSpy).not.toHaveBeenCalled();
    expect(fakeEvents.emitted).toHaveLength(0);

    // Airline deactivate looks up moderators before mutating and isolates HotelsService
    await service.deactivateProvider(ProviderType.AIRLINE, airlineId, adminId);
    expect(getModsSpy.mock.invocationCallOrder[0]).toBeLessThan(
      setAirlineSpy.mock.invocationCallOrder[0],
    );
    expect(setAirlineSpy).toHaveBeenCalledWith(airlineId, false);
    expect(setHotelSpy).not.toHaveBeenCalled();
    expect((await fakeFlights.getAirline(airlineId))?.isActive).toBe(false);
    expect(fakeEvents.payloadsOf(Events.ProviderDeactivated)).toEqual([
      {
        eventId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        providerType: ProviderType.AIRLINE,
        providerId: airlineId,
        moderatorIds: [modA1, modA2],
      },
    ]);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: adminId,
        action: AuditAction.PROVIDER_DEACTIVATED,
        target: { type: ProviderType.AIRLINE, id: airlineId },
      },
    ]);

    // Hotel reactivate with zero moderators still emits with []
    fakeEvents.clear();
    getModsSpy.mockClear();
    setAirlineSpy.mockClear();
    setHotelSpy.mockClear();
    await service.reactivateProvider(ProviderType.HOTEL, hotelId, adminId);
    expect(getModsSpy.mock.invocationCallOrder[0]).toBeLessThan(
      setHotelSpy.mock.invocationCallOrder[0],
    );
    expect(setHotelSpy).toHaveBeenCalledWith(hotelId, true);
    expect(setAirlineSpy).not.toHaveBeenCalled();
    expect(fakeEvents.payloadsOf(Events.ProviderReactivated)).toEqual([
      {
        eventId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        providerType: ProviderType.HOTEL,
        providerId: hotelId,
        moderatorIds: [],
      },
    ]);
    expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
      {
        actorId: adminId,
        action: AuditAction.PROVIDER_REACTIVATED,
        target: { type: ProviderType.HOTEL, id: hotelId },
      },
    ]);

    // Lookup failure leaves provider state untouched and emits zero events
    fakeEvents.clear();
    setAirlineSpy.mockClear();
    getModsSpy.mockRejectedValueOnce(new Error('lookup failed'));
    await expect(
      service.reactivateProvider(ProviderType.AIRLINE, airlineId, adminId),
    ).rejects.toThrow('lookup failed');
    expect(setAirlineSpy).not.toHaveBeenCalled();
    expect((await fakeFlights.getAirline(airlineId))?.isActive).toBe(false);
    expect(fakeEvents.emitted).toHaveLength(0);

    // Provider write failure emits zero events (e.g. missing provider or write error)
    const missingId = '6736f0b2c5a1b2c3d4e59999';
    await expect(
      service.deactivateProvider(ProviderType.HOTEL, missingId, adminId),
    ).rejects.toMatchObject({
      constructor: NotFoundException,
      response: { code: ErrorCode.NotFound },
    });
    expect(fakeEvents.emitted).toHaveLength(0);
    expect(suspendSpy).not.toHaveBeenCalled();
    expect(reactivateSpy).not.toHaveBeenCalled();
  });
});
