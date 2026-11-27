import { BadRequestException, ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { assertChangeable, checkNewFlight } from './flight-change-rules.js';
import type {
  ChangeableBooking,
  ChangeableSegment,
  NewFlight,
} from './flight-change-rules.js';

const now = new Date('2026-12-01T12:00:00Z');
const hoursFromNow = (hours: number) =>
  new Date(now.getTime() + hours * 60 * 60 * 1000);

const outbound = (
  overrides: Partial<ChangeableSegment> = {},
): ChangeableSegment => ({
  direction: 'outbound',
  flightId: 'flight-out',
  departureAirportId: 'CAI',
  arrivalAirportId: 'DXB',
  cabinClass: 'economy',
  departureAt: hoursFromNow(48),
  arrivalAt: hoursFromNow(52),
  ...overrides,
});

const inbound = (
  overrides: Partial<ChangeableSegment> = {},
): ChangeableSegment => ({
  direction: 'return',
  flightId: 'flight-back',
  departureAirportId: 'DXB',
  arrivalAirportId: 'CAI',
  cabinClass: 'economy',
  departureAt: hoursFromNow(120),
  arrivalAt: hoursFromNow(124),
  ...overrides,
});

const booking = (
  overrides: Partial<ChangeableBooking> = {},
): ChangeableBooking => ({
  status: 'confirmed',
  hasPendingChange: false,
  segments: [outbound(), inbound()],
  ...overrides,
});

/** A different flight on the outbound route, a day later. */
const newOutbound = (overrides: Partial<NewFlight> = {}): NewFlight => ({
  flightId: 'flight-out-2',
  status: 'scheduled',
  departureAirportId: 'CAI',
  arrivalAirportId: 'DXB',
  cabinClasses: ['economy', 'business'],
  departureAt: hoursFromNow(72),
  arrivalAt: hoursFromNow(76),
  ...overrides,
});

/** A different flight on the return route, a day later. */
const newReturn = (overrides: Partial<NewFlight> = {}): NewFlight => ({
  flightId: 'flight-back-2',
  status: 'scheduled',
  departureAirportId: 'DXB',
  arrivalAirportId: 'CAI',
  cabinClasses: ['economy'],
  departureAt: hoursFromNow(144),
  arrivalAt: hoursFromNow(148),
  ...overrides,
});

/** Runs `fn` and returns what it threw (fails the test if it didn't throw). */
function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('assertChangeable (FLT-27)', () => {
  it('accepts a confirmed booking whose segment has not departed', () => {
    expect(() => assertChangeable(booking(), 'outbound', now)).not.toThrow();
    expect(() => assertChangeable(booking(), 'return', now)).not.toThrow();
  });

  it.each(['pending_payment', 'completed', 'expired', 'cancelled'] as const)(
    'refuses a %s booking with 409 INVALID_STATUS_TRANSITION',
    (status) => {
      const error = thrownBy(() =>
        assertChangeable(booking({ status }), 'outbound', now),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: ErrorCode.InvalidStatusTransition,
      });
    },
  );

  it('refuses a second change while one is waiting for payment (409)', () => {
    const error = thrownBy(() =>
      assertChangeable(booking({ hasPendingChange: true }), 'outbound', now),
    );
    expect(error).toBeInstanceOf(ConflictException);
  });

  it('refuses a segment that departs now or has departed (409)', () => {
    const departingNow = booking({
      segments: [outbound({ departureAt: now })],
    });
    expect(
      thrownBy(() => assertChangeable(departingNow, 'outbound', now)),
    ).toBeInstanceOf(ConflictException);
  });

  it('still lets the return be changed after the outbound has flown', () => {
    const outboundFlown = booking({
      segments: [
        outbound({
          departureAt: hoursFromNow(-5),
          arrivalAt: hoursFromNow(-1),
        }),
        inbound(),
      ],
    });
    expect(() => assertChangeable(outboundFlown, 'return', now)).not.toThrow();
  });

  it('rejects changing the return of a one-way booking with 400 VALIDATION_FAILED', () => {
    const oneWay = booking({ segments: [outbound()] });
    const error = thrownBy(() => assertChangeable(oneWay, 'return', now));
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: ErrorCode.ValidationFailed,
      details: [{ field: 'direction' }],
    });
  });
});

describe('checkNewFlight (FLT-27)', () => {
  const segments = [outbound(), inbound()];

  it('accepts another scheduled flight on the same route with the same cabin', () => {
    expect(checkNewFlight(segments, 'outbound', newOutbound(), now)).toEqual(
      [],
    );
    expect(checkNewFlight(segments, 'return', newReturn(), now)).toEqual([]);
  });

  it('rejects the flight the booking is already on', () => {
    const problems = checkNewFlight(
      segments,
      'outbound',
      newOutbound({ flightId: 'flight-out' }),
      now,
    );
    expect(problems).toEqual([
      { field: 'flightId', message: expect.stringMatching(/already/) },
    ]);
  });

  it.each([
    ['departure airport', { departureAirportId: 'ALX' }],
    ['arrival airport', { arrivalAirportId: 'AUH' }],
  ])('rejects a different %s (same route only)', (_label, overrides) => {
    const problems = checkNewFlight(
      segments,
      'outbound',
      newOutbound(overrides),
      now,
    );
    expect(problems).toEqual([
      { field: 'flightId', message: expect.stringMatching(/route/) },
    ]);
  });

  it('rejects a flight without the booked cabin class', () => {
    const problems = checkNewFlight(
      segments,
      'outbound',
      newOutbound({ cabinClasses: ['business'] }),
      now,
    );
    expect(problems).toEqual([
      { field: 'flightId', message: expect.stringMatching(/economy/) },
    ]);
  });

  it.each(['cancelled', 'departed'] as const)(
    'rejects a %s flight',
    (status) => {
      const problems = checkNewFlight(
        segments,
        'outbound',
        newOutbound({ status }),
        now,
      );
      expect(problems).toEqual([
        { field: 'flightId', message: expect.stringMatching(/scheduled/) },
      ]);
    },
  );

  it('rejects a scheduled flight that departs now or earlier', () => {
    const problems = checkNewFlight(
      segments,
      'outbound',
      newOutbound({ departureAt: now, arrivalAt: hoursFromNow(4) }),
      now,
    );
    expect(problems).toEqual([
      { field: 'flightId', message: expect.stringMatching(/scheduled/) },
    ]);
  });

  it('rejects a new outbound that arrives after the return departs', () => {
    const problems = checkNewFlight(
      segments,
      'outbound',
      newOutbound({
        departureAt: hoursFromNow(118),
        arrivalAt: hoursFromNow(122), // return departs at +120
      }),
      now,
    );
    expect(problems).toEqual([
      { field: 'flightId', message: expect.stringMatching(/return/) },
    ]);
  });

  it('rejects a new return that departs before the outbound arrives', () => {
    const problems = checkNewFlight(
      segments,
      'return',
      newReturn({
        departureAt: hoursFromNow(50), // outbound arrives at +52
        arrivalAt: hoursFromNow(54),
      }),
      now,
    );
    expect(problems).toEqual([
      { field: 'flightId', message: expect.stringMatching(/outbound/) },
    ]);
  });

  it('rejects a new return that departs exactly when the outbound arrives', () => {
    const problems = checkNewFlight(
      segments,
      'return',
      newReturn({ departureAt: hoursFromNow(52), arrivalAt: hoursFromNow(56) }),
      now,
    );
    expect(problems).toHaveLength(1);
  });

  it('reports every broken rule at once', () => {
    const problems = checkNewFlight(
      segments,
      'outbound',
      newOutbound({
        arrivalAirportId: 'AUH',
        cabinClasses: ['first'],
        status: 'cancelled',
      }),
      now,
    );
    expect(problems).toHaveLength(3);
  });
});
