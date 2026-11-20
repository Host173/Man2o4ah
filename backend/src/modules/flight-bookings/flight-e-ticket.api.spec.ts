import { EventEmitter2 } from '@nestjs/event-emitter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { loginAs, type LoggedInUser } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Events } from '../../common/events/events.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { BOOKING_REFERENCE } from './flight-confirmation.service.js';
import { FlightHoldService } from './flight-hold.service.js';

const AIRLINE = '6553a1f0c2b4e8a9d0f1e201';
const FLIGHT = '6553a1f0c2b4e8a9d0f1e202';
const CABIN = '6553a1f0c2b4e8a9d0f1e203';

/** Chromium starts slowly when the whole suite shares the CPU (cf. HOOK_TIMEOUT). */
const PDF_TIMEOUT = 60_000;

/** 08:00 UTC from Cairo (UTC+2 in March) to Dubai (UTC+4), landing 12:00 UTC. */
function seedFlights(withTimeZones: boolean): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS', name: 'Nile Air' });
  data.addFlight({
    id: FLIGHT,
    airlineId: AIRLINE,
    flightNumber: 'MS100',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAt: new Date('2027-03-10T08:00:00.000Z'),
    arrivalAt: new Date('2027-03-10T12:00:00.000Z'),
    cabins: [
      { id: CABIN, cabinClass: 'economy', totalSeats: 50, priceMinor: 20_000 },
    ],
  });
  if (withTimeZones) {
    // What getFlightsForBooking returns once flights adds the airports' zones
    // to FlightView (asked of the flights owner; FlightManagementView has them).
    Object.assign(data.flight(FLIGHT)!, {
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'Asia/Dubai',
    });
  }
  return data;
}

const request: FlightQuoteRequestDto = {
  tripType: 'one_way',
  segments: [{ flightId: FLIGHT, cabinId: CABIN }],
  passengers: [
    {
      type: 'adult',
      fullName: 'Aya Amr',
      dateOfBirth: '1990-01-01',
      documentNumber: 'A1234567',
      extraBagCount: 0,
    },
  ],
};

/** All the text of a PDF, page after page. */
async function pdfText(bytes: Buffer): Promise<string> {
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  try {
    const pdf = await loading.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(
        content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      );
    }
    return pages.join('\n');
  } finally {
    await loading.destroy();
  }
}

describe('GET /api/flight-bookings/:id/e-ticket (FLT-23)', () => {
  let t: TestApp;
  let owner: LoggedInUser;
  const flights = new FakeFlightsService();
  const seats = new FakeSeatInventory();
  let references = 0;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(flights)
          .overrideProvider(SeatInventory)
          .useValue(seats)
          .overrideProvider(PaymentsService)
          .useValue(new FakePaymentsService())
          .overrideProvider(BOOKING_REFERENCE)
          .useValue(() => `FBTKT${String((references += 1)).padStart(3, '0')}`),
    });
  }, HOOK_TIMEOUT);

  async function reseed(withTimeZones = true): Promise<void> {
    const data = seedFlights(withTimeZones);
    Object.assign(flights, new FakeFlightsService(data));
    Object.assign(seats, new FakeSeatInventory(data));
    await clearCollections(t.connection);
    owner = await loginAs(t.connection, UserRole.USER);
  }

  /** A held booking of the owner, confirmed by a payment unless `paid` is false. */
  async function booking(paid = true): Promise<{ id: string; ref?: string }> {
    const hold = await t.moduleRef
      .get(FlightHoldService)
      .hold(request, owner.id);
    if (!paid) return { id: hold.bookingId };
    await t.moduleRef.get(EventEmitter2).emitAsync(Events.PaymentSucceeded, {
      bookingType: 'flight',
      bookingId: hold.bookingId,
    });
    return {
      id: hold.bookingId,
      ref: `FBTKT${String(references).padStart(3, '0')}`,
    };
  }

  const eTicket = (id: string, user: LoggedInUser = owner) =>
    t
      .http()
      .get(`/api/flight-bookings/${id}/e-ticket`)
      .set('Cookie', user.cookie);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it(
    'downloads a PDF named after the reference for the owner',
    async () => {
      await reseed();
      const { id, ref } = await booking();

      const res = await eTicket(id).expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="${ref}.pdf"`,
      );
      const bytes = res.body as Buffer;
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

      const text = await pdfText(bytes);
      for (const expected of [
        ref!,
        'Aya Amr',
        'MS100',
        'Nile Air',
        'CAI',
        'DXB',
      ]) {
        expect(text).toContain(expected);
      }
    },
    PDF_TIMEOUT,
  );

  // GEN-06: flight times in each airport's local time zone.
  it(
    'shows each time in its airport’s local time zone',
    async () => {
      await reseed(true);
      const { id } = await booking();

      const text = await pdfText(
        (await eTicket(id).expect(200)).body as Buffer,
      );

      expect(text).toContain('10:00'); // 08:00 UTC in Cairo
      expect(text).toContain('Africa/Cairo');
      expect(text).toContain('16:00'); // 12:00 UTC in Dubai
      expect(text).toContain('Asia/Dubai');
    },
    PDF_TIMEOUT,
  );

  it(
    'shows UTC, labelled, when the airport’s zone is not available',
    async () => {
      await reseed(false);
      const { id } = await booking();

      const text = await pdfText(
        (await eTicket(id).expect(200)).body as Buffer,
      );

      expect(text).toContain('08:00');
      expect(text).toContain('UTC');
    },
    PDF_TIMEOUT,
  );

  it('answers 404 NOT_FOUND for another user’s booking (ACC-11)', async () => {
    await reseed();
    const { id } = await booking();
    const stranger = await loginAs(t.connection, UserRole.USER);

    const res = await eTicket(id, stranger).expect(404);
    expect(res.body.code).toBe(ErrorCode.NotFound);
  });

  it.each([
    ['an unknown id', () => new Types.ObjectId().toHexString()],
    ['a malformed id', () => 'not-an-id'],
  ])('answers 404 NOT_FOUND for %s', async (_label, id) => {
    await reseed();
    const res = await eTicket(id()).expect(404);
    expect(res.body.code).toBe(ErrorCode.NotFound);
  });

  it('answers 409 CONFLICT before the booking is paid', async () => {
    await reseed();
    const { id } = await booking(false);

    const res = await eTicket(id).expect(409);
    expect(res.body.code).toBe(ErrorCode.Conflict);
  });

  it('answers 401 NOT_AUTHENTICATED without a login', async () => {
    await reseed();
    const { id } = await booking();

    const res = await t
      .http()
      .get(`/api/flight-bookings/${id}/e-ticket`)
      .expect(401);
    expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
  });

  it('is documented in Swagger as a PDF with its requirement ID', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operation = document.paths['/api/flight-bookings/{id}/e-ticket']?.get;
    expect(operation?.summary).toMatch(/^FLT-23 /);
    expect(operation?.responses['200']).toMatchObject({
      content: { 'application/pdf': expect.anything() },
    });
  });
});
