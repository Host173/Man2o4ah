# Testing

Backend now; frontend testing is decided before Milestone 2. Decisions: `docs/DECISIONS.md` §12.

## Contents
1. The four levels
2. When TDD is required
3. Test design techniques
4. Integration tests on the in-memory database
5. Faking other modules and external services
6. API tests
7. E2E flows
8. Files, names, commands, coverage

## 1. The four levels

| Level | What it tests | When written | Tools |
|---|---|---|---|
| Unit | one function or class, no database, fakes for dependencies | with the feature | Vitest |
| Integration | one module's service with the real in-memory MongoDB (queries, indexes, transactions, concurrency) | with the feature | Vitest, `@nestjs/testing`, mongodb-memory-server |
| API | one endpoint over HTTP: success, 400/401/403/404/409, exact response shape | with the feature | Vitest, Supertest |
| E2E | a whole user journey across modules, several scenarios per flow | end of each sprint, then on every PR | Vitest, Supertest |

**No PR without tests.** The ticket says which levels it needs.

## 2. When TDD is required

Test first (the test commit comes **before** the code commit, so it's visible in history) for precise business rules:
- pricing (infant 10%, baggage per segment), refund tiers, budget totals and conversion
- booking status transitions, inventory (`SeatInventory`, `RoomNightInventory`)
- lockout, and any rule with an exact number in the requirement
- **every bug fix:** first a failing test that reproduces the bug

Elsewhere (CRUD, wiring) tests come in the same PR as the code. Tickets mark it as **"TDD: required"**.

## 3. Test design techniques

- **Boundary values:** test at the edges, e.g. password length 7/8, day 60/61, hold age 9:59/10:00, a refund tier at exactly `daysBefore` and one day less.
- **Equivalence classes:** one test per group that behaves the same (adult, child, infant), not one per value.
- **Decision tables:** every combination of conditions (which refund tier applies for each number of days left).
- **State transitions:** every allowed status change works and every illegal one is rejected (refunding an unpaid booking).
- **Negative tests:** wrong input, wrong user (404), wrong role (403), not logged in (401).

## 4. Integration tests on the in-memory database

`createTestApp` (`backend/test/support/test-app.ts`) starts a one-node in-memory replica set (transactions work), builds your module with the production app wiring (`configureApp`), and waits for every index. It returns `{ app, moduleRef, connection, http, close }`. Tests **never** touch Atlas or read `.env`.
```ts
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({
    imports: [FlightsModule],                                                            // your module, real
    override: (b) => b.overrideProvider(ReferenceDataService).useValue(fakeReferenceData), // other modules, fake
  });
}, HOOK_TIMEOUT);
beforeEach(() => clearCollections(t.connection));                                        // no leftover data
afterAll(() => t.close(), HOOK_TIMEOUT);
```
Pitfalls and their fixes:
- **Leftover data** makes results depend on test order: wipe collections in `beforeEach`.
- **Indexes are built in the background:** `createTestApp` already waits for the indexes. A test that builds its own module must `await Model.init()` before relying on a unique index, or a duplicate slips through and the test passes wrongly.
- **Concurrency tests:** fire with `Promise.allSettled` and assert the **invariant** (exactly 5 succeeded, counters add up), never which request won or the order.
- **Scope:** only your own module is real; fake the others, or your test breaks whenever they change.
- The first run downloads the MongoDB binary (CI caches it).

## 5. Faking other modules and external services

- **Other modules:** `overrideProvider(XService).useValue({ method: vi.fn() })`, shaped exactly like the real service's public methods. Ports: provide a fake under the port's token.
- **Before the other module exists:** write the fake from the contract in `docs/database/data-model.md` §4 and §6 (inventory methods, ports, events). Replace it with the real one at integration time.
- **Stripe and FXRatesAPI** sit behind adapter classes in their modules; tests swap the adapter, never call the network. Webhooks are tested by calling the handler with a constructed event (and a test for a bad signature).
- **Time:** `vi.useFakeTimers()` / `vi.setSystemTime()` for holds, expiry and "today" rules.
- **Events:** override `AppEvents` with `new FakeEvents()` (`backend/test/support/fake-events.ts`) and assert `fake.payloadsOf(Events.X)`.

## 6. API tests

Supertest against the real Nest app (in-memory DB, fakes for external services):
```ts
await request(app.getHttpServer()).post('/api/flight-bookings/hold').set('Cookie', userCookie).send(body)
  .expect(409).expect(res => expect(res.body.code).toBe('SEATS_UNAVAILABLE'));
```
Log in with `const u = await loginAs(t.connection, 'user')` (`backend/test/support/auth.ts`; any role, moderators get a `providerId`) and send `.set('Cookie', u.cookie)`. `loginAs` creates a real user and session and signs the token the way the auth guard expects.

Cover: the success response shape (no `passwordHash`, correct pagination shape), 400 with field `details`, 401 without a cookie, 403 with the wrong role, 404 for another user's resource (ACC-11), 409 for conflicts. Assert the status and the **code**, never the message wording.

## 7. E2E flows

`backend/test/e2e/<journey>.e2e-spec.ts`, one file per journey, several scenarios each (happy path, cancel with refund, hold expiry, failed payment then retry, sold out). Written at the end of each sprint for the flows built so far, then kept as regression tests on every PR. Steps whose module isn't merged yet use fakes. Keep E2E to the important journeys; edge cases belong in lower levels.

## 8. Files, names, commands, coverage

- Unit, integration and API tests sit next to the code: `<name>.spec.ts` (unit/integration), `<name>.controller.spec.ts` or `<name>.api.spec.ts` (API). E2E in `backend/test/e2e/`.
- Commands: `npm test`, `npm run test:cov`, `npm run verify` (CI's full set).
- Coverage: **every** `src/modules/**/*.service.ts` file needs ≥ 80% lines on its own (per file). Coverage of the rest is reported.
- Never weaken, skip or delete a test to make a suite pass. Changing a test is fine only when the specified behaviour changed.
