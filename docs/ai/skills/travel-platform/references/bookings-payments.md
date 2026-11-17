# Bookings, holds, payments, refunds

Covers FLT-06/12/19/21/22/23/25/26/29, HTL-16/17/18/20/21/22, PAY-01..04, GEN-11. Highest-risk area: follow it exactly. Field definitions: `docs/database/data-model.md` §3.4, §3.6, §3.7; inventory §4; lifecycles §5.

Modules: **flight-bookings** and **hotel-bookings** (Bookings package) own bookings; **flights** and **hotels** own inventory; **payments** (Platform package) owns Stripe. Payments never writes a booking; bookings never call Stripe directly.

## Contents
1. Lifecycle (GEN-11)
2. Flight hold (FLT-22)
3. Hotel hold (HTL-18)
4. Policies and payment (PAY-02, PAY-01)
5. Expiry
6. Stripe webhook and confirmation
7. Cancellations and refunds (FLT-26, FLT-06, HTL-21, PAY-03)
8. References, e-ticket, completion
9. Frontend flow
10. Proving concurrency

## 1. Lifecycle

```
pending_payment ──payment.succeeded──► confirmed ──trip/stay over──► completed
       │                                  │
       └──hold expired──► expired          └──user/provider cancels──► cancelled
```
Every status change is a **conditional update** on the old status:
```ts
const r = await this.bookingModel.updateOne({ _id, status: from }, { $set: { status: to, ... } }, { session });
if (r.modifiedCount !== 1) throw new ConflictException({ code: ErrorCode.InvalidStatusTransition, message: '...' });
```
The filter is what makes races safe (webhook vs expiry job vs user cancel): exactly one writer wins. Allowed moves: `pending_payment → confirmed | expired`, `confirmed → completed | cancelled`. Nothing else.

Hold length: 10 minutes. `holdExpiresAt = createdAt + 10 min`, returned to the client for the countdown.

## 2. Flight hold

Two endpoints take the same body `{ tripType, segments: [{ flightId, cabinId }] (1 or 2), passengers: [{ type, fullName, dateOfBirth, documentNumber, extraBagCount, extraBagWeightKg }] }`:
- `POST /api/flight-bookings` (FLT-19, FLT-21) is the **quote**: validates and prices, returns the summary. Writes nothing.
- `POST /api/flight-bookings/hold` (FLT-22) repeats validation and pricing, then reserves and creates the `pending_payment` booking.

Validate (400 `VALIDATION_FAILED` with `details`):
- ≥ 1 adult; infants ≤ adults. Each passenger's type matches their age **on the outbound departure date**: adult 12+, child 2–11, infant under 2.
- Extra bags ≤ every segment airline's `maxExtraBagsPerPassenger`; weight per bag ≤ every segment cabin's `maxBagWeightKg`.
- Round trip: the return departs from the outbound arrival airport, to its origin, after the outbound arrives.
- The airline is `isActive`, each flight is `scheduled` with departure in the future (`FlightsService` exposes the checks).

Price on the server, per segment (snapshot `fareMinor` = cabin `priceMinor` now):
`fares = seatCount × fareMinor + infants × round(fareMinor × 10 / 100)`; `baggage = Σ extraBagCount × extraBagPriceMinor` (that segment's airline). `totalMinor` = sum over segments. `seatCount = adults + children` (infants take no seat).

Snapshot into each segment: `fareMinor`, airline, flight number, airports, times, and `policy` (cancellation tiers, free bags, max weight, extra-bag price and max). Refunds later use **these** tiers.

Reserve atomically, in one transaction:
```ts
await session.withTransaction(async () => {
  await this.seatInventory.hold(segments.map(s => ({ flightId: s.flightId, cabinId: s.cabinId, seats: seatCount })), { session });
  await this.bookingModel.create([{ ...snapshot, status: 'pending_payment', holdExpiresAt }], { session });
});
// SeatInventory.hold throws SEATS_UNAVAILABLE (409) → the whole transaction rolls back
```
`SeatInventory.hold` does the `availableSeats ≥ n` check and the `$inc` in **one** document update (data-model §4.1). Never read `availableSeats` and then write.

## 3. Hotel hold

`POST /api/hotel-bookings` body: `{ hotelId, checkInDate, checkOutDate, rooms: [{ roomId, adults, childAges: number[] }] }`.

Validate: `checkInDate ≥ today (UTC)`, `checkOutDate > checkInDate`, all rooms belong to `hotelId`, the hotel is active, each room's guests ≤ `maxOccupancy`, each room has ≥ 1 guest, total adults ≥ 1, child ages 0–17.
Price: `Σ nights × room.pricePerNightMinor` (snapshot per room). Nights are `checkInDate … checkOutDate − 1 day`.

Reserve, in one transaction:
```ts
await session.withTransaction(async () => {
  const [res] = await this.reservationModel.create([{ ...snapshot, status: 'pending_payment', holdExpiresAt }], { session });
  await this.roomNightInventory.reserve(hotelId, roomIds, checkInDate, checkOutDate, res._id, { session });
});
// RoomNightInventory.reserve throws ROOMS_UNAVAILABLE (409) → nothing is held (all-or-nothing, HTL-18)
```
`reserve` checks each room is active with the whole stay inside one availability range, bumps the room's `inventoryVersion`, then inserts one `room_nights` document per room per night. The unique index `{ roomId, date }` rejects any night that is already reserved or blocked (data-model §4.2).

## 4. Policies and payment

1. `GET /api/bookings/:type/:id/policies` (payments module, via `PayableBooking.getPolicies`): the booking's **policy snapshot** (airline: tiers and baggage; hotel: tiers and check-in/out times).
2. `POST /api/bookings/:type/:id/accept-policies` `{ accepted: true }`: payments stores a `policy_acceptances` document with `acceptedAt` (PAY-02). The accepted policy is the booking's snapshot, so nothing is copied.
3. `POST /api/payments` `{ bookingType, bookingId }` (payments):
   - Through `PayableBooking.getPayable`: the booking belongs to the user, is `pending_payment`, `holdExpiresAt > now` (else `409 HOLD_EXPIRED`). An acceptance must exist (else `409 POLICIES_NOT_ACCEPTED`).
   - If a payment exists for the booking with status `pending` or `failed`, return its PaymentIntent's `client_secret` (retries reuse it; one payment per booking).
   - Otherwise create the PaymentIntent (amount = `totalMinor`, currency `usd`, `metadata: { bookingType, bookingId }`, idempotency key `pi-<type>-<bookingId>`), save `payments { stripePaymentIntentId, amountMinor, currency, status: 'pending' }`, return `{ paymentId, clientSecret, amountMinor, currency, holdExpiresAt }`.
4. `POST /api/payments/:id/retry` sets `failed → pending` and returns the same client secret. `GET /api/payments/:id` returns the status to the owner.

The client secret is the only Stripe value the browser sees. Card data never touches our servers (Payment Element). **A booking is confirmed only by the verified webhook**, never by a frontend call.

## 5. Expiry (booking modules' jobs, every 30 s)

```
for each booking with status pending_payment and holdExpiresAt ≤ now (batches of 100):
  transaction:
    conditional update pending_payment → expired (skip if modifiedCount = 0)
    flight: SeatInventory.release(segments)      hotel: RoomNightInventory.release(reservationId)
  after commit: emit flight-booking.expired / hotel-reservation.expired
payments listens: cancels the PaymentIntent (if pending/failed), sets the payment canceled.
  Ignore "already succeeded" errors: the late-payment path refunds those (§6).
```

## 6. Stripe webhook and confirmation

`POST /api/payments/webhook` (payments, `@Public()`, raw body):
```ts
let event: Stripe.Event;
try { event = this.stripe.webhooks.constructEvent(req.rawBody!, sig, this.webhookSecret); }
catch { throw new BadRequestException({ code: ErrorCode.BadSignature, message: 'Invalid signature' }); }
```
`handleEvent`:
1. **Idempotency:** insert `stripe_webhook_events { _id: event.id }`. A duplicate-key error means already processed: return 200.
2. `payment_intent.succeeded`: set the payment `succeeded`, then emit `payment.succeeded { bookingType, bookingId }`.
3. `payment_intent.payment_failed`: set the payment `failed`. The booking stays pending so the user can retry until the hold expires.
4. `refund.updated` / `refund.failed`: map Stripe's status (`succeeded` → `refunded`, `failed`/`canceled` → `failed`), emit `refund.updated`.
5. Return quickly; ignore other types.

**The booking module confirms** on `payment.succeeded`, in one transaction:
- conditional `pending_payment → confirmed`, set `confirmedAt` and the reference (§8);
- flight: `SeatInventory.confirm(segments)` (held → booked); hotel: nothing (the nights stay);
- after commit: emit `…confirmed` (→ notifications).
- **Late payment:** if the booking is no longer `pending_payment` (it expired), don't confirm. Ask payments for a full refund with `reason: 'late_payment'`.

Local dev: `stripe listen --forward-to localhost:4000/api/payments/webhook` prints the `whsec_…` secret for `.env`. Test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined, `4000 0025 0000 3155` needs 3-D Secure.

## 7. Cancellations and refunds

**Tier rule (FLT-09, HTL-10):** `days = floor((start − now) / 1 day)` (flight: outbound departure; hotel: check-in date at 00:00 UTC). Pick the tier with the largest `daysBefore ≤ days`; none → 0%. `refundAmountMinor = round(totalMinor × percent / 100)`. Use the booking's **snapshot** tiers. Write it as a pure function with TDD (decision table + boundaries). Each booking module has its **own copy** (flight-bookings and hotel-bookings), with its own tests; neither imports the other (`DECISIONS.md` §3).

Preview: `GET /api/flight-bookings/:id/refund-preview`, `GET /api/hotel-bookings/:id/refund-preview` → `{ percent, amountMinor, currency }`.

- **User cancels a flight (FLT-26):** owner, `confirmed`, outbound departure in the future. Round trips cancel as a whole using the **outbound** tiers (FLT-12).
- **User cancels a hotel stay (HTL-21):** owner, `confirmed`, today < `checkInDate`. Whole reservation only.

In one transaction: conditional `confirmed → cancelled` with `cancellation { cancelledAt, cancelledBy, refundPercent, refundAmountMinor }`; release inventory (flight `SeatInventory.returnBooked`; hotel `RoomNightInventory.release`).
After commit: if `refundAmountMinor > 0`, call `PaymentsService.refund(...)` (creates `refunds { status: 'pending' }`, calls Stripe with idempotency key `refund-<refundId>`, maps the result). Then emit `…cancelled`. A Stripe failure leaves the booking cancelled and the refund `failed`, visible on the booking (PAY-03), never lost.

**Provider cancels a flight (FLT-06):** flights sets `scheduled → cancelled` and emits `flight.cancelled`. flight-bookings cancels every `confirmed` booking containing it (round trips included) with **100%** and `cancelledBy: 'provider'`, and expires its `pending_payment` ones. Everyone affected is notified.
A deactivated provider (ACC-15) is hidden from search and can't be booked; existing confirmed bookings stay valid.

## 8. References, e-ticket, completion

- Reference: `FB` (flights) or `HR` (hotels) + 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (`crypto.randomInt`). Unique (partial) index; retry on 11000. Set on confirmation.
- E-ticket (FLT-23): `GET /api/flight-bookings/:id/e-ticket` (owner, `confirmed`) builds a PDF and returns a `StreamableFile` (`application/pdf`, `attachment; filename="<ref>.pdf"`). Times in each airport's local zone.
- Completion (jobs): a flight booking becomes `completed` when `lastDepartureAt ≤ now`; a hotel reservation when `checkOutDate < today`. Only completed stays can be reviewed (HTL-23).
- Flight time changes (FLT-05): on `flight.rescheduled`, flight-bookings updates its segment copies and `first/lastDepartureAt`, then notifies confirmed passengers.

## 9. Frontend flow

Flight: search → select flight and cabin → passengers form → `POST /flight-bookings` (quote) → summary page (FLT-21) with the airline policies and an acceptance checkbox → "Pay" → `POST /flight-bookings/hold` → `accept-policies` → `POST /payments` → payment page with a countdown from `holdExpiresAt`.
Hotel: search → rooms (HTL-15) → guests per room → summary with policies and checkbox → `POST /hotel-bookings` (hold) → `accept-policies` → `POST /payments` → payment page with countdown.
Payment page: `<Elements options={{ clientSecret }}><PaymentElement/></Elements>` → `stripe.confirmPayment({ elements, redirect: 'if_required' })` → poll the booking every 2 s (max ~30 s) until `confirmed` → confirmation with the reference and e-ticket. At 0 on the countdown, disable payment and offer to search again.

## 10. Proving concurrency (required test)

Integration tests on the in-memory replica set (`testing.md` §4):
- A cabin with 5 available seats: fire 6 parallel `hold(1)` calls → exactly 5 succeed, 1 fails with `SEATS_UNAVAILABLE`, and `total = available + held + booked` still holds.
- Overlapping stays on the same room in parallel → exactly one succeeds.
- Expiry job and confirmation racing on the same booking → exactly one transition wins.
Assert invariants, never which request won. Put the result in the PR description.
