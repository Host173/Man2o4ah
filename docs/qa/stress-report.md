# System stress and failure check — 2026-11-21, develop 5514761

TST-03 (#222). Branch `test/TST-03-system-stress-check`. Run with `cd backend && npm run test:stress` (not part of CI).

## Summary

58 probes (56 run, 2 skipped) in 9 areas (races, lifecycle, access, input, externals, atomicity, integrity, load, restart) against the whole app plus the PLT-08 demo world, on the in-memory replica set with Stripe and the FX API faked.

Findings: CRITICAL 2, HIGH 3, MEDIUM 5, LOW 1 (11 in total). Every one has a failing reproduction under `backend/test/stress/findings/` and a fix on its own branch, where that reproduction passes. Invariants broken after any attack: yes, by S-01 (a paid booking left `confirmed` on a cancelled flight). No oversold seats, double charges or double refunds were found.

Process: each finding was handed, as soon as it was found, to an Opus agent that designed the fix (for S-09 and S-10/S-11 the main session designed it), then to a Sonnet agent that implemented it test-first in its own worktree. The fix branches were then merged into one branch, `test/TST-03-stress-check-and-fixes`, with this check, and opened as one PR.

## Findings and fixes (most serious first)

| ID | Severity | Area | Problem | Rule broken | Cause | Fix | Branch |
|---|---|---|---|---|---|---|---|
| S-01 | CRITICAL | races | A moderator cancels a flight while a passenger's payment webhook lands. In 5 of 10 rounds the booking ends `confirmed` on the cancelled flight: paid, seats booked, never refunded. | FLT-06: all confirmed bookings become cancelled with a 100% refund | `seat-inventory.ts` confirm didn't check the flight status. `flight-provider-cancellation.service.ts:158` parked a booking that lost a race as `skipped` and never rescanned it. | `SeatInventory.confirm` fences on `status: scheduled` (409 SEATS_UNAVAILABLE otherwise). The confirmation then expires the booking, releases the seats and refunds in full (`late_payment`). The provider handler rescans a batch that had skips. | `fix/TST-03-S-01-confirmed-on-cancelled-flight` |
| S-07 | CRITICAL | atomicity | The payment webhook succeeds but the confirmation transaction fails once. The booking later expires and the customer is charged with no booking and no refund. | §6/PAY-03: money taken ends confirmed or refunded, "never lost" | `flight-confirmation.service.ts:62` (and the hotel one) only log the failure. `payment-expiry.listener.ts:55` skips a `succeeded` payment. | On a booking-expiry event, the payments expiry listener refunds a `succeeded` payment in full (`late_payment`). There is one refund per booking. | same branch as S-01 |
| S-03 | HIGH | input | A JSON body nested 10 000 levels deep (≈60 KB) gets 500 "Maximum call stack size exceeded" on public `/api/auth/login` and `/register` and on every DTO route. | backend.md §6: invalid input is a 400, never a 500 | `app.setup.ts:27` global ValidationPipe → class-transformer recursion | New `common/http/body-depth.ts`: an iterative depth check (max 32) runs right after the JSON parser, before guards and pipes, and answers 400 VALIDATION_FAILED. | `fix/TST-03-S-03-S-04-S-05-input-hardening` |
| S-04 | HIGH | input | A cabin price may be up to `Number.MAX_SAFE_INTEGER`. Quoting or holding 2+ seats then gives 500 because the total overflows. Rooms, extra bags and itinerary amounts have the same problem. | backend.md §6; money is safe integers | `add-flight-cabin.dto.ts:29` and similar DTOs; `multiplyMinor` throws a plain Error (`money.ts:8`) | Price caps: `MAX_PRICE_MINOR` $100k per priced unit, `MAX_AMOUNT_MINOR` for itinerary amounts. ≤ 9 passengers and ≤ 9 rooms per booking. A total over Stripe's $999,999.99 gives 400. `AmountOverflowError` maps to 400. Recorded in DECISIONS.md §9. | same branch as S-03 |
| S-08 | HIGH | atomicity | One booking of a cancelled flight fails to cancel (any error in its transaction). It is parked "for a redelivery" that never comes, so it stays confirmed on the cancelled flight. | FLT-06 | `flight-provider-cancellation.service.ts:163`, `:108`; `flight.cancelled` is in-process | A failed booking is retried once before being parked. A booking that fails twice still needs the sweep job (follow-up 2). | same branch as S-01 |
| S-02 | MEDIUM | access | The documented guest page `GET /api/itineraries/public/:id` doesn't exist, so a public itinerary can't be opened read-only. | ITN-21, endpoints.md | `itineraries.controller.ts:115` only has `public/search` | New `@Public() GET public/:id`, the same for every viewer. Private, hidden or deactivated-author itineraries get 404. Budget is in the platform currency, `null` without FX rates. | `fix/TST-03-S-02-public-itinerary-page` |
| S-06 | MEDIUM | externals | Booking details never show the refund status (pending/refunded/failed), so a failed refund is invisible. | PAY-03 "show its status on the booking details" | `my-flight-bookings.service.ts:109`, `hotel-reservations.service.ts:272` never call `PaymentsService.getRefund` | `refund: RefundView \| null` on `GET /flight-bookings/:id` and `GET /hotel-bookings/:id`, read after the ownership check. | `fix/TST-03-S-06-S-09-refund-status-and-review-author` |
| S-09 | MEDIUM | integrity | Hotel reviews carry no author, so a deactivated author can't show as "Deleted user". | ACC-12 | `hotel-reviews.service.ts` list mapping | One batched `AccountsService.getProfiles` call adds `authorName` to each list item ("Deleted user" when deactivated). | same branch as S-06 |
| S-10 | MEDIUM | load | With 1 000 hotels, hotel search is far over budget: p95 2.7 s in the full load run, 1.9 s alone. | TST-03 load budget p95 < 500 ms | `hotels.service.ts:497-573` loads every hotel and room of the city and builds a full view for each before paginating | Filter and sort light `{id, price, rating}` records with projections, then load full documents only for the page. Order, tie-break and totals are unchanged. | `fix/TST-03-S-10-S-11-query-performance` |
| S-11 | MEDIUM | load | The admin bookings list scans all of `flight_bookings` and sorts in memory. The blog author-name search scans all of `users`. | TST-03 H2: no COLLSCAN on collections with > 1 000 documents | Sort `{createdAt:-1,_id:-1}` (`flight-bookings.service.ts:43`) has no matching index; unanchored regex on `users.name` | Indexes `{createdAt:-1,_id:-1}` on both booking collections and `{name:1}` on users. `paginate()` uses `estimatedDocumentCount()` for an empty filter. | same branch as S-10 |
| S-05 | LOW | input | Paths outside `/api` (`/`, `/uploads/missing.png`) get Express's HTML 404. | api-contract §3: every error is JSON | `app.setup.ts:24` global prefix; Nest's not-found handler only covers `/api` | `notFoundOutsidePrefix('api')` middleware, last in `configureApp`, answers the JSON 404. | same branch as S-03 |

Fix verification: the implementer reports that each fix branch's reproduction(s) pass and `npm run verify` passes. The main session re-ran every reproduction on its fix branch (see "Re-runs" below).

### Re-runs (main session)

Every reproduction fails on this branch (develop plus the probes only) and passes on its fix branch:

| Branch | Reproductions re-run | Result |
|---|---|---|
| `fix/TST-03-S-01-confirmed-on-cancelled-flight` | S-01, S-07, S-08 | 3/3 pass |
| `fix/TST-03-S-02-public-itinerary-page` | S-02 | 1/1 pass |
| `fix/TST-03-S-03-S-04-S-05-input-hardening` | S-03, S-04, S-05 | 3/3 pass |
| `fix/TST-03-S-06-S-09-refund-status-and-review-author` | S-06, S-09 | 2/2 pass |
| `fix/TST-03-S-10-S-11-query-performance` | S-10, S-11 | 2/2 pass |

`npm run verify` as reported by each implementer: S-01/07/08 3 369 tests, S-02 3 358, S-03/04/05 3 382, S-10/11 3 343, all passing. On S-06/09, 3 350 of 3 351 passed; the one failure was the known `itinerary-pdf.api.spec.ts` timeout under load, which passes alone.

## Load results (area H, in-memory database, 50 concurrent × 5 rounds)

| Endpoint | p50 | p95 | queries/page | COLLSCAN on |
|---|---|---|---|---|
| flight search, one-way | 364 ms | 802 ms | 3 | — |
| flight search, round trip | 603 ms | 731 ms | 6 | — |
| hotel search | 2154 ms | 2673 ms | 5 | — (S-10) |
| hotel availability | 279 ms | 351 ms | 3 | — |
| public itinerary search | 365 ms | 412 ms | 4 | countries, cities (8 documents each, fine) |
| blog list | 332 ms | 413 ms | 3 | — |
| blog search | 504 ms | 1125 ms | 4 | users, 2 012 documents (S-11) |
| admin bookings | 614 ms | 763 ms | 6 | flight_bookings, 5 001 documents (S-11) |
| notifications | 290 ms | 425 ms | 4 | — |

Volume, written through the models for the test only: 5 000 flights over 60 days, 1 000 hotels × 4 rooms, 2 000 users, 5 000 bookings, 3 000 posts, 500 itineraries.

- The test client runs in the same process as the app, so the latencies are inflated.
- Flight search, blog search and the admin list are over the 500 ms budget but under the 2 s hard limit. They are recorded here, not as findings.
- No endpoint ran more than 6 queries per page (no N+1). No list returns more than 50 items.
- H4: 2 000 overdue holds all expire in batches with every seat released, but it takes about 23 s with one transaction per hold, against a job that runs every 30 s.

## Undocumented behaviour (Kareem decides)

- No maximum hotel stay is documented. A 3 000-night stay is accepted, or refused only by availability, and no 5xx.
- A pending hold of a provider that is then deactivated can still be paid (no 5xx). ACC-15 only says new bookings are refused.
- London DST: a non-existent local time (`2027-03-28T01:30`) and an ambiguous one (`2027-10-31T01:30`) are accepted without a 5xx. The docs don't say whether to reject or shift them.
- S-04's limits ($100k per priced unit, 9 passengers, 9 rooms, $999,999.99 per booking, 10^12 for itinerary amounts) are new contract decisions (DECISIONS.md §9). The $999,999.99 assumes Stripe's default per-charge maximum; check it for the account.
- S-10/S-11 `paginate()` now reports `total` from `estimatedDocumentCount()` for unfiltered lists. It is fast, but can be briefly approximate after an unclean shutdown.

## Probe corrections

- **B5:** each new hold expired the previous overdue hold first, as backend.md §10 requires. The holds are now ended only after all are created.
- **C1:** refresh answers 204, not 200. The probe accepts any 2xx.
- **D1:** the webhook was removed from the bad-JSON cases. FakeStripeGateway parses any body under its fixed signature; real signature checks are probed in E5.
- **Harness:** HealthModule was missing from the stress app.
- **F9, G2:** `DELETE /users/me` needs `{ confirm: true }`.
- **F6, G5:** the activity id was read from the wrong response field.
- **H:** `structuredClone` turned ObjectIds into plain objects. Clones now use a copy that keeps ObjectIds and Dates.
- **S-11 repro:** cloned bookings drop the unique `reference`.

## What held up (one line per area)

- **Races:** last seats, multi-seat holds, round-trip all-or-nothing, overlapping and adjacent stays, parallel payment start, webhook vs expiry (20 rounds), double cancel, cancel vs completion, register/like/report races and capacity cuts during holds all behave; seats and nights stay consistent.
- **Lifecycle:** hold boundaries ±1 s, late payment, failed-then-retry, out-of-order and replayed webhooks, jobs run twice at once, time zones and DST storage, leap days and date order.
- **Access:**
  - Every protected route answers 401 without a cookie. Expired token, refresh, logout, suspension and password change revoke as documented.
  - Role escalation gets 403. Cross-provider access and other users' data get 404.
  - Mass-assigned fields get 400. Operator injection gets 400. Regex-heavy searches answer in under 1 s. Lockout locks once.
- **Input:** malformed, huge and wrong-shaped JSON, bad ids, length limits, emoji/RTL text, hostile numbers, pagination extremes, uploads (signature, size, count, traversal) and wrong methods are all handled, apart from S-03/S-04/S-05.
- **Externals:** Stripe down on PaymentIntent creation, refund and cancel; FX down and no rates (503 RATES_UNAVAILABLE); bad, missing and huge webhooks.
- **Atomicity:** hold, hotel hold, cancellation, room deactivate/delete, provider and account deactivation all roll back and succeed on retry. Confirmation and provider cancellation were the exceptions (S-07, S-08).
- **Integrity:** provider deactivation, account deactivation (blocked by an upcoming booking; posts and itineraries hidden; comments show "Deleted user"), rooms with reservations, reschedules updating segments and notifying, duplicate events and read-only reference data.
- **Restart:** a hold and a started payment finish correctly after a restart, and every declared unique index is live.

## Not attacked

- **F6 and G5** (clone with images): the probe's activity image upload kept answering 400, so the copy-failure path and the clone-survives-deletion check never ran. They are `it.skip` in the specs.

## Follow-ups (not done, to keep the fixes small)

1. S-07 Part B: retry the confirmation of a paid pending booking before it expires (a booking instead of a refund).
2. S-08 Part B: a periodic sweep that finishes the cancellation of bookings still active on cancelled flights. It also covers a crash between the flight cancel and its handler.
3. Refund reconciliation: a refund request that throws after a cancellation commits leaves no refund record. This covers user and provider cancellations and the S-07 path.
4. The completion job can complete a confirmed booking on a cancelled flight if it runs before the cancellation handler.
5. The flight confirmation still lacks the ACC-12 account fence that hotels have (bookings-payments.md §6).
6. Pending holders on a cancelled flight get no notification ("everyone affected is notified", FLT-06).

## Branches

Everything ships in one branch, `test/TST-03-stress-check-and-fixes` (from develop 5514761): the stress check plus the five fix branches, merged with `--no-ff` so each fix keeps its own commits.

| Fix branch (merged) | Fixes |
|---|---|
| `fix/TST-03-S-01-confirmed-on-cancelled-flight` | S-01, S-07, S-08 |
| `fix/TST-03-S-02-public-itinerary-page` | S-02 |
| `fix/TST-03-S-03-S-04-S-05-input-hardening` | S-03, S-04, S-05 |
| `fix/TST-03-S-06-S-09-refund-status-and-review-author` | S-06, S-09 |
| `fix/TST-03-S-10-S-11-query-performance` | S-10, S-11 |

The merges had no conflicts. One follow-up commit removes a HealthModule import that two branches had both added to `stress-app.ts`.

### Combined run

With every fix merged, on this branch:

- `npm run test:stress`: 20 of 20 spec files and 75 tests pass, 2 skipped (F6, G5). That includes all 11 finding reproductions.
- `npm run verify`: format, lint, typecheck, 209 test files / 3,439 tests (96.72 % lines) and the build all pass, exit 0.
