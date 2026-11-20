/**
 * S-04 · HIGH · input
 *
 * Rule broken: backend.md §6 "400 invalid input or broken rule" and
 * api-contract §3 — no request may end in 500; money is integer minor units
 * (PAY-04, data-model: amounts are safe integers).
 *
 * What breaks: a moderator may set a cabin price up to
 * Number.MAX_SAFE_INTEGER (FLT-04 DTO), and any user then quoting or holding
 * 2+ seats on it gets 500 INTERNAL_ERROR ("Not a valid amount in minor
 * units"), because the total no longer fits a safe integer. Hotel rooms allow
 * the same price (create-room.dto.ts:59), so nights × price overflows too.
 *
 * Cause: src/modules/flights/dto/add-flight-cabin.dto.ts:29 (`@Max(Number.
 * MAX_SAFE_INTEGER)` on priceMinor) and no cap on the passenger count
 * (flight-quote.dto.ts:100-105); src/modules/flight-bookings/flight-pricing.ts:52
 * multiplies through `multiplyMinor`, which throws a plain Error
 * (src/common/money/money.ts:8) that the filter maps to 500.
 *
 * Suggested fix: cap prices at a realistic maximum in the cabin/room DTOs and
 * bound passengers/rooms per booking, and turn an overflowing total into 400
 * VALIDATION_FAILED in the quote/hold instead of a 500.
 */
import { createFlight, holdFlight } from '../support/flows.js';
import { createStressApp, type Stress } from '../support/stress-app.js';

describe('S-04 totals that overflow a safe integer', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(() => s?.close());

  it('refuses the price or the booking with a 4xx, never a 500', async () => {
    const mod = await s.as(s.world.airlines.NA.moderator);
    const user = await s.newUser('s04');
    let flight;
    try {
      flight = await createFlight(s, mod, {
        seats: 9,
        priceMinor: Number.MAX_SAFE_INTEGER,
      });
    } catch {
      return; // A capped price (400 on the cabin) is a valid fix.
    }
    const quote = await user.post('/flight-bookings', {
      tripType: 'one_way',
      segments: [{ flightId: flight.flightId, cabinId: flight.cabinId }],
      passengers: Array.from({ length: 9 }, (_, i) => ({
        type: 'adult',
        fullName: `P ${i}`,
        dateOfBirth: '1990-01-01',
        documentNumber: `P10000${i}`,
        extraBagCount: 0,
      })),
    });
    const hold = await holdFlight(user, flight, 9);
    expect(
      [quote.status, hold.status].map((st) => st >= 400 && st < 500),
      'backend.md §6: an impossible total is a 4xx, never a 500',
    ).toEqual([true, true]);
    expect(await s.invariants()).toEqual([]);
  });
});
