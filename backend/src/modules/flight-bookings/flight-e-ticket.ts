import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { chromium } from 'playwright';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { FlightsService } from '../flights/flights.service.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

/** One line of the e-ticket's flight table. */
interface TicketSegment {
  direction: string;
  airline: string;
  flightNumber: string;
  from: string;
  to: string;
  departs: string;
  arrives: string;
  cabin: string;
}

/** Escapes user text before it goes into the e-ticket's HTML. */
function html(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** `10 Mar 2027, 10:00 (Africa/Cairo)`: a UTC instant shown in a zone (GEN-06). */
function localTime(at: Date, zone: string | undefined): string {
  const timeZone = zone ?? 'UTC';
  try {
    const text = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(at);
    return `${text} (${timeZone})`;
  } catch {
    // An unknown zone name: never show a wrong local time, show UTC instead.
    return localTime(at, 'UTC');
  }
}

/**
 * The flight e-ticket (FLT-23): a PDF for the owner of a confirmed booking,
 * with the reference, the passengers and every flight in its airports' local
 * time (GEN-06). Another user's booking answers 404 (ACC-11).
 */
@Injectable()
export class FlightETicket {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    private readonly flights: FlightsService,
  ) {}

  async render(
    bookingId: string,
    userId: string,
  ): Promise<{ filename: string; pdf: Buffer }> {
    if (!Types.ObjectId.isValid(bookingId) || !Types.ObjectId.isValid(userId)) {
      throw notFound();
    }
    const booking = await this.bookingModel
      .findOne({ _id: bookingId, userId })
      .lean();
    if (!booking) throw notFound();
    if (
      booking.status !== FlightBookingStatus.CONFIRMED ||
      !booking.reference
    ) {
      throw new ConflictException({
        code: ErrorCode.Conflict,
        message: 'The e-ticket is available once the booking is confirmed',
      });
    }

    const found = await this.flights.getFlightsForBooking(
      booking.segments.map((s) => s.flightId.toString()),
    );
    const segments: TicketSegment[] = booking.segments.map((s) => {
      const entry = found.get(s.flightId.toString());
      const flight = entry?.flight;
      return {
        direction: s.direction === 'outbound' ? 'Outbound' : 'Return',
        airline: entry?.airline.name ?? s.airlineId.toString(),
        flightNumber: s.flightNumber,
        from: s.departureAirportId,
        to: s.arrivalAirportId,
        departs: localTime(s.departureAt, flight?.departureTimeZone),
        arrives: localTime(s.arrivalAt, flight?.arrivalTimeZone),
        cabin: s.cabinClass.replace('_', ' '),
      };
    });

    const pdf = await printPdf(
      document(booking.reference, booking.passengers, segments),
    );
    return { filename: `${booking.reference}.pdf`, pdf };
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'Booking not found',
  });
}

function document(
  reference: string,
  passengers: { fullName: string; type: string; documentNumber: string }[],
  segments: TicketSegment[],
): string {
  const rows = (cells: string[][]) =>
    cells
      .map(
        (row) => `<tr>${row.map((c) => `<td>${html(c)}</td>`).join('')}</tr>`,
      )
      .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; font-size: 12px; color: #111; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
    th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
  </style></head><body>
    <h1>E-ticket</h1>
    <p>Booking reference: <strong>${html(reference)}</strong></p>
    <h2>Flights</h2>
    <table><tr><th></th><th>Airline</th><th>Flight</th><th>From</th><th>To</th><th>Departs (local)</th><th>Arrives (local)</th><th>Cabin</th></tr>
    ${rows(segments.map((s) => [s.direction, s.airline, s.flightNumber, s.from, s.to, s.departs, s.arrives, s.cabin]))}</table>
    <h2>Passengers</h2>
    <table><tr><th>Name</th><th>Type</th><th>Passport/ID</th></tr>
    ${rows(passengers.map((p) => [p.fullName, p.type, p.documentNumber]))}</table>
  </body></html>`;
}

/** Prints the HTML to an A4 PDF; no scripts and no network requests. */
async function printPdf(page: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
    });
    await tab.route('**/*', (route) => route.abort());
    await tab.setContent(page);
    return await tab.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    });
  } finally {
    await browser.close();
  }
}
