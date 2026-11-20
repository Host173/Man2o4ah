import type { FlightBookingStatus } from './schemas/flight-booking.schema.js';
import type { CabinClass } from '../../common/database/cabin-class.js';

export interface FlightPassengerCsvRow {
  reference: string;
  passengerName: string;
  cabinClass: CabinClass;
  seatCount: number;
  status: FlightBookingStatus;
}

const HEADERS = ['Reference', 'Passenger Name', 'Cabin', 'Seats', 'Status'];

/** Escapes one CSV cell and prevents spreadsheet formula execution. */
export function escapeCsvCell(value: string): string {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safeValue)
    ? `"${safeValue.replaceAll('"', '""')}"`
    : safeValue;
}

/** Returns the passenger list as RFC-style CSV rows separated with CRLF. */
export function flightPassengersCsv(rows: FlightPassengerCsvRow[]): string {
  return [
    HEADERS,
    ...rows.map((row) => [
      row.reference,
      row.passengerName,
      row.cabinClass,
      String(row.seatCount),
      row.status,
    ]),
  ]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n');
}
