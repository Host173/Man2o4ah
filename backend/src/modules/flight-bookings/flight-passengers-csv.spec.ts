import { escapeCsvCell, flightPassengersCsv } from './flight-passengers-csv.js';

describe('flight passenger CSV (FLT-29)', () => {
  it('quotes commas, quotes and newlines, doubling embedded quotes', () => {
    expect(escapeCsvCell('Doe, "Jane"\nSecond line')).toBe(
      '"Doe, ""Jane""\nSecond line"',
    );
  });

  it.each(['=SUM(1+1)', '+1+1', '-1+1', '@SUM(1+1)'])(
    'prefixes formula-leading cell %s',
    (value) => {
      expect(escapeCsvCell(value)).toBe(`'${value}`);
    },
  );

  it('writes one row per passenger with the booking details', () => {
    expect(
      flightPassengersCsv([
        {
          reference: 'FBABC123',
          passengerName: 'Aya Amr',
          cabinClass: 'economy',
          seatCount: 2,
          status: 'confirmed',
        },
        {
          reference: 'FBABC123',
          passengerName: 'Jana Test',
          cabinClass: 'economy',
          seatCount: 2,
          status: 'confirmed',
        },
      ]),
    ).toBe(
      'Reference,Passenger Name,Cabin,Seats,Status\r\n' +
        'FBABC123,Aya Amr,economy,2,confirmed\r\n' +
        'FBABC123,Jana Test,economy,2,confirmed',
    );
  });
});
