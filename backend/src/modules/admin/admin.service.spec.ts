import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { FakeFlightBookingsService } from '../../../test/fakes/flight-bookings.fake.js';
import { FakeHotelBookingsService } from '../../../test/fakes/hotel-bookings.fake.js';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service.js';
import type { FlightBookingAdminView } from '../flight-bookings/flight-bookings.types.js';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema.js';
import { Airline } from '../flights/schemas/airline.schema.js';
import { Flight } from '../flights/schemas/flight.schema.js';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service.js';
import type { HotelReservationAdminView } from '../hotel-bookings/hotel-bookings.types.js';
import { HotelReservation } from '../hotel-bookings/schemas/hotel-reservation.schema.js';
import { Review } from '../hotel-bookings/schemas/review.schema.js';
import { AdminModule } from './admin.module.js';
import { AdminService } from './admin.service.js';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto.js';

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
  it('provides and exports AdminService from AdminModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AdminModule],
    })
      .overrideProvider(getModelToken(FlightBooking.name))
      .useValue({})
      .overrideProvider(getModelToken(Airline.name))
      .useValue({})
      .overrideProvider(getModelToken(Flight.name))
      .useValue({})
      .overrideProvider(getModelToken(HotelReservation.name))
      .useValue({})
      .overrideProvider(getModelToken(Review.name))
      .useValue({})
      .compile();

    expect(moduleRef.get(AdminService)).toBeInstanceOf(AdminService);
  });

  it('returns empty page when no bookings exist', async () => {
    const service = new AdminService(
      new FakeFlightBookingsService([]) as unknown as FlightBookingsService,
      new FakeHotelBookingsService([]) as unknown as HotelBookingsService,
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
    const service = new AdminService(
      new FakeFlightBookingsService(
        flights,
      ) as unknown as FlightBookingsService,
      new FakeHotelBookingsService(hotels) as unknown as HotelBookingsService,
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
    const service = new AdminService(
      new FakeFlightBookingsService([]) as unknown as FlightBookingsService,
      new FakeHotelBookingsService([]) as unknown as HotelBookingsService,
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
    const service = new AdminService(
      new FakeFlightBookingsService([
        leakyFlight,
      ]) as unknown as FlightBookingsService,
      new FakeHotelBookingsService([]) as unknown as HotelBookingsService,
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
    const service = new AdminService(
      new FakeFlightBookingsService(
        flights,
      ) as unknown as FlightBookingsService,
      new FakeHotelBookingsService(hotels) as unknown as HotelBookingsService,
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
    const service = new AdminService(
      fakeFlights as unknown as FlightBookingsService,
      fakeHotels as unknown as HotelBookingsService,
    );

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
});
