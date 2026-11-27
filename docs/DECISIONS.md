# Travel Platform — Locked Decisions

Decisions the team has agreed on. Don't change a locked decision without the team leader (Kareem).
If a question isn't answered here and can't be decided alone, don't assume: ask the team leader.

Last updated: 2026-11-20 (durable blog image cleanup)

---

## 1. Architecture

- **Course terms:** MVC. Model = MongoDB Atlas + NestJS schemas/services, View = Next.js, Controller = NestJS controllers.
- **What it really is:** a layered client-server system. Inside the backend it is a **modular monolith**: one NestJS app, split into feature modules, each with the same layers (controller → service → schema).
- In docs and the evaluation we use the course's MVC terms; if asked, it is "MVC at the system level, implemented as a layered modular monolith".
- Business rules live in services, never in controllers.

## 2. Modules

| Module | Purpose | Owns |
|---|---|---|
| reference-data | Course datasets, read-only | countries, cities, airports, attractions, currencies |
| accounts | Registration, login, lockout, sessions, profiles, roles, moderator assignment (auth lives here) | users (with moderator assignment), sessions |
| flights | Airline moderator's world | airlines (with policies), flights (with cabins and seat counters) |
| flight-bookings | Traveler's flight bookings | flight bookings (with segments and passengers; a hold is a `pending_payment` booking) |
| hotels | Hotel moderator's world | hotels (with policies), rooms, room_nights (inventory) |
| hotel-bookings | Traveler's hotel reservations and reviews | hotel reservations (a hold is a `pending_payment` reservation), reviews |
| payments | Stripe payments, refunds, policy acceptance for both booking types | payments, refunds, policy acceptances, stripe webhook events |
| itineraries | Trip planning and budgeting | itineraries (with days, activities, budgets, transport costs) |
| fx | FXRatesAPI integration and rate caching | cached exchange rates |
| blog | Community content | posts (with tags), comments, likes, post_image_cleanups |
| moderation | Reports on any content type | reports |
| notifications | In-app notifications, triggered by events | notifications |
| audit | Logs of important admin and moderation actions, triggered by events | audit logs |
| admin | Admin endpoints; calls other modules' services | **no data** |

Infrastructure (not domain modules):
- **storage:** a NestJS module that validates and saves uploaded images (GEN-08). Owns no collection; modules store image references (`{ _id, key }`) on their own documents. Files are stored on the server's disk and served by URL (GEN-08). How uploads persist in the cloud deployment is open (deployment topic).
- **common:** shared guards (roles, ownership), error filter, pagination helper, decorators. No business logic.

## 3. Module rules

- **Account deactivation and payment confirmation (ACC-12, 20 Nov):** the requester confirmed Aisha, Aya and Kareem's approval of the shared changes. Confirmation calls `AccountsService.tryLockForBookingConfirmation(userId, { session })` in its transaction; accounts increments the user's existing Mongoose `__v` to fence writes. Self-deactivation changes the user's status before checking both booking ports on that same transaction snapshot. If deactivation wins, paid pending hotel reservations expire and release inventory transactionally, then request a full `late_payment` refund after commit. This is an approved additional hold-expiry trigger, not a new lifecycle state. Suspension leaves existing bookings valid. Future flight confirmation must use the same fence and inventory/session protocol.

- **Passwords are 8 to 72 characters, with at least one letter and one digit.** One shared rule in `accounts/auth/password-rule.ts` (`/^(?=.*[A-Za-z])(?=.*\d).{8,72}$/`), applied in the DTOs to every new password: registration, password change, the forced change and admin resets. Login and the current password on change-password accept any non-empty string, so temporary passwords and passwords stored before the cap still work. Why: bcrypt ignores everything after 72 bytes, so without a cap two long passwords sharing their first 72 bytes would both work. The cap counts characters (JS string length), not UTF-8 bytes; whether to count bytes is open item 1. Decided 17 Nov (raised in PR #126, built in ACC-08).
- **One owner per collection.** Each collection belongs to exactly one module.
- **Cross-module access goes through the owning module's exported service.** A module never queries another module's collections directly.
- **No populate across modules.** Mongoose populate only within a module.
- **Inventory belongs to the provider modules:** seats to flights, room-nights to hotels. Booking modules call their services (e.g. `holdSeats`, `reserveNights`).
- **Background jobs live in the module that owns the data:** hold expiry and completion in flight-bookings and hotel-bookings (they own the pending bookings), marking flights departed in flights, rate refresh in fx. No separate jobs module.
- **Blog image cleanup (BLG-10, 20 Nov):** post deletion transactionally retains image keys in blog-owned `post_image_cleanups`. Files are deleted after commit; failures are logged and retried every 30 seconds, including after restarts, while the committed deletion returns 204. Kareem and Mostafa's approval of this model/job change and its inclusion in PR #173 was confirmed by the requester.
- **A hold is a pending booking.** There is no separate holds collection; the inventory counters/nights live in the provider modules.
- **Modules talk through services, ports and events.** Lower modules never import higher ones; when they must, the lower module owns an interface (port) or emits an event. The allowed imports, ports and events are listed in `data-model.md` §6.
- **Notification change identity (GEN-01, 20 Nov):** with Kareem/affected owners' approval, reschedule and account/provider notification events require a stable `eventId`, reused on redelivery. Different committed changes have different IDs. Read state and intervening opposite changes never identify an event; distinct reschedules notify even when earlier alerts are unread. No collection schema or index changes.
- **Flight booking changes (FLT-27, 28 Nov):** the requester confirmed Kareem's approval of the data model change and of the payments changes, made by the Bookings owner in the FLT-27 PR. `flight_bookings` gains `pendingChange` (a change that costs more, waiting for payment, its new seats held) and `changes[]` (history); `segments`, `pricing` and `first/lastDepartureAt` are updated in place when a change completes, and the booking stays `confirmed`. A change costing the same or less is applied at once; a lower total is refunded in full (no cancellation tiers). `refunds` gains `changeId` and the `booking_change` reason, with the unique index `{ bookingType, bookingId, changeId }`: still one cancellation refund per booking, plus one refund per change. `PaymentsService.getRefund` keeps returning the cancellation refund.
- **Booking rules are implemented in each booking module.** The GEN-11 lifecycle (allowed status moves) and the FLT-09/HTL-10 refund tiers are needed by both flight-bookings and hotel-bookings. Each module has its own copy, with its own tests; neither imports the other, and they don't go in `common/` (no business logic there). The two copies must follow the same rule (HTL-10 uses FLT-09's selection rule); only the start date differs (flight: outbound departure; hotel: check-in at 00:00 UTC). Why: each module owns all of its logic, there's no coupling between the booking modules, and one owner (Bookings) keeps both copies in step. Decided 17 Nov (PR #130).
- **Endpoints that combine provider and booking data live in the booking module** (FLT-29 in flight-bookings; HTL-08 and HTL-22 in hotel-bookings), whatever their URL.
- **"My flight bookings" groups (FLT-25, 20 Nov):** Kareem approved this rule, confirmed by the requester. `GET /api/flight-bookings?group=upcoming|past|cancelled` lists the user's own bookings, one group per request, in the standard paged list. **Upcoming** = `confirmed` with `firstDepartureAt > now`, soonest first (the same rule as `ActiveBookingsCheck`). **Past** = `completed`, or `confirmed` whose first departure has passed (a round trip in progress, or a trip the completion job hasn't reached yet), most recent first. **Cancelled** = `cancelled`, most recent departure first. `pending_payment` and `expired` bookings are in no group; the owner can still open them with `GET /api/flight-bookings/:id`. The 15-minute completion job moves `confirmed` bookings to `completed` once `lastDepartureAt` has passed.
- **New features:** if a feature fits an existing module's data and rules, it extends that module. A new module is created only for a feature totally different from all current modules (new data no existing module owns).
- Bonus features that would likely become new modules: favourites, admin analytics. Email notifications would be a channel inside notifications.

## 4. Data access

- **No repository layer in general.** Services use the injected Mongoose model directly.
- **Exception, inventory:** `SeatInventory` (flights) and `RoomNightInventory` (hotels) are the only classes that change inventory. Every caller (booking holds, hold expiry, moderator capacity changes) uses them; nobody rewrites those queries.

## 5. Database process

- Kareem (with Claude) drafts the schema → the team reviews it in one meeting (each module owner signs off on their own collections) → the schema is frozen.
- After the freeze, a schema change goes through the team leader as a small PR.
- Order: module boundaries first, then the schema, then the people split.
- **Documentation, two artifacts kept in sync in the same PR:**
  - **UML class diagrams** (Mermaid, `docs/database/class-diagrams.md` and `docs/database/diagrams/`), for the team. Composition (filled diamond) = embedded; association (arrow) = reference by ID. Grouped by module.
  - **`docs/database/data-model.md`**, for coding agents and the source of truth: per collection, the owning module, fields and types, required/optional, embedded vs referenced, indexes, validation. Mongoose schemas are written from it.

- **Deliverables of the database design:** the data model doc, the class diagram(s), an execution file for Claude Code to build the Mongoose schemas, and a team PDF explaining each module (purpose, choices and why, tricky parts, possible future conflicts).
- **Team review:** each member evaluates their own modules from the PDF and takes responsibility for them. Changes are requested now, before the freeze.
- **The project skill must contain all module and data model details,** so members can ask it when they want to understand more.

## 6. Reference data

- The course's CSV datasets (countries, cities, airports, attractions) are used in the final evaluation through Swagger.
- Their identifiers are kept exactly as given; the API must accept them as written.
- The seed script imports them exactly (no renaming, filtering or cleaning) and is safe to re-run without creating duplicates.

## 7. Hosting

- **MongoDB Atlas,** the shared team database required by the course (section 8.11). No self-hosted MongoDB.

## 8. Local databases

- **Tests:** `mongodb-memory-server` in replica-set mode (transactions need it). Each test run gets a fresh in-memory MongoDB. Tests never touch Atlas.
- **Load/concurrency tests:** run locally on the memory server, not on Atlas (the free tier's throughput cap would distort results).
- **Offline development (optional):** MongoDB in Docker, started as a single-node replica set. Switching between local and Atlas is only a change to `MONGODB_URI` in `.env`.

## 9. Data conventions (from the data model)

- **Money:** integers in minor units (`priceMinor`). **Platform currency: USD** (PAY-04; to be confirmed in the team review).
- **Money limits (stress finding S-04):** one priced unit (cabin seat, room night, extra bag) is at most 10,000,000 minor units ($100,000.00); one booking total is at most 99,999,999 (Stripe's per-charge maximum); a booking has at most 9 passengers (infants included) or 9 rooms; one itinerary amount is at most 1,000,000,000,000 in its own currency's minor units. Over a limit is a 400; a sum or product that is not a safe integer is a 400 too (`AmountOverflowError`). Existing data over a cap is not migrated; quoting it answers 400.
- **Times:** instants in UTC; calendar dates stored as midnight UTC (`DateOnly`); "today" for date-only rules is the UTC date. Flight times are entered and shown in the airport's local time.
- **Snapshots:** bookings copy prices and provider policies at hold time; refunds use the snapshot.
- **Concurrency:** seats are held with one atomic conditional update on the cabin; rooms are held with one `room_nights` document per room per night (unique index). Status changes are conditional updates (`{ _id, status: from }`).
- The full list of design calls awaiting team confirmation is in `data-model.md` §8.

## 10. Toolchain (from the scaffold)

- **Node 26** (LTS; `.nvmrc`), **NestJS 12** (ESM), **Mongoose 9**, **Next.js 16** (App Router).
- **Backend tests: Vitest.** **Backend lint: oxlint.**
- **Vitest doesn't type-check**, so `npm run typecheck` (`tsc --noEmit`, covering `src` and `test`) is a required gate next to lint, test and build.
- **Mongoose references:** declare ObjectId fields with `@Prop({ type: MongooseSchema.Types.ObjectId })`, never `Types.ObjectId` (NestJS turns that into an untyped Mixed field). No `ref` on any prop. A test enforces both.
- **Files are UTF-8 without BOM** (Windows PowerShell can add one).
- Backend runs on port 4000, frontend on 3000. Swagger at `/api/docs`.
- Branches: `main` (milestone releases) and `develop` (integration); work on `<type>/<ID>-<description>` branches (§18). Conventional Commits.

## 11. Work split (7 packages, one owner each)

Each package owns whole modules, backend (M1) and pages (M2).

| # | Package | Modules | Owner |
|---|---|---|---|
| 1 | Platform & Payments | reference-data, common wiring (events, ports, jobs), storage, notifications, audit, fx, payments | Kareem (`Host173`; also reviews all PRs and finds extra features) |
| 2 | Accounts & Auth | accounts | Aisha (`AishaAlRawahi`) |
| 3 | Flights | flights (incl. `SeatInventory`, flight search) | Jana (`janaelmenshawy`) |
| 4 | Hotels | hotels (incl. `RoomNightInventory`, hotel search) | Pierre (`pierreofficial`) |
| 5 | Bookings | flight-bookings, hotel-bookings (incl. reviews) | Aya (`Hestias-space`) |
| 6 | Itineraries | itineraries | Mokhtar (`Mohamed-Mokhtar-Elalfy-16009527`) |
| 7 | Community & Admin | blog, moderation, admin | Mostafa (`mostafa-elsahy`) |

Team: Kareem Sayed Ahmed (leader), Pierre Remon Raafat, Mostafa Elsahy, Aisha Al Rawahi, Aya Amr, Jana Elmenshawi, Mohamed Mokhtar Shaker.

- **First days:** Kareem's foundation (events, ports, storage, notifications stub), Accounts' auth guards and `@CurrentUser`, and the inventory classes from Flights and Hotels.
- **Until then, build against fakes;** tests override the auth guard. Requirements that need another package's finished work go last (ACC-17, ITN-25/26, ACC-12's booking check).

## 12. Testing (backend; frontend testing is decided before M2)

| Level | Tests | When written | Tools |
|---|---|---|---|
| Unit | one function/class, no database, fakes for dependencies | with the feature (TDD where required) | Vitest |
| Integration | one module's service with the real in-memory MongoDB (queries, indexes, transactions, concurrency) | with the feature | Vitest, `@nestjs/testing`, mongodb-memory-server |
| API | one endpoint over HTTP: success, 400/401/403/404/409, exact response shape | with the feature | Vitest, Supertest |
| E2E (backend) | whole user journeys across modules, several scenarios per flow | at the end of each sprint, then run on every PR | Vitest, Supertest |

- **No PR without tests.**
- **TDD (test commit before code commit) is required** for precise business rules: pricing, refund tiers, booking status transitions, inventory, budget totals and conversion, lockout, and every bug fix (a failing test that reproduces the bug comes first). **Tickets mark this as "TDD: required".**
- **Every ticket states its tests:** which levels it needs (unit, integration, API, E2E), whether TDD is required, and the test design techniques that apply (e.g. boundary values for limits, a decision table for refund tiers, state transitions for statuses).
- Elsewhere, tests come in the same PR as the code.
- Test design techniques: boundary values, equivalence classes, decision tables, state-transition tests, negative tests.
- Integration tests: wipe collections in `beforeEach`; `await Model.init()` before relying on unique indexes; assert invariants, never the order of concurrent results; use only your own module for real and fake the others.
- External services (Stripe, FXRatesAPI) are faked behind their adapter in tests.

## 13. CI

- **GitHub-hosted Actions** for now, with savings: run on pull requests and on merges to `develop`/`main` only; cancel superseded runs; path filters per app; cache npm and the MongoDB test binary.
- **CI is ticket PLT-01** (branch `chore/PLT-01-ci-pipeline`). The single required status check is `ci-ok`, plus the PR checks (naming, commits, secrets).
- **Plan B (PLT-02):** a self-hosted runner on an Azure VM, switched on by changing `runs-on`, if usage approaches the monthly minutes.
- Required checks on `develop` and `main`: CI green + team leader approval. Tests need no secrets.
- Local habit: `npm run verify` runs the same checks before pushing.

## 14. CI quality gates (every PR to `develop`/`main`)

**These constraints must appear in three places: the project skill, `AGENTS.md`, and the README.**

| Gate | Rule | Default detail (adjust when the CI ticket is built) |
|---|---|---|
| Format | check only, never auto-fix in CI | the formatter the scaffold set up (Prettier unless NestJS 12 chose another) |
| Lint | oxlint, zero errors | no disable comments without a reason in the PR |
| Typecheck | `tsc --noEmit` over `src` and `test` | |
| Tests + coverage | all levels pass, coverage reported | minimum 80% lines on `*.service.ts` in business modules |
| Build | backend and frontend build | |
| PR title / branch | requirement ID present | branch `<type>/<ID>-<description>`, PR title `<ID>: <title>` (e.g. `FLT-22: Flight seat hold`) |
| Security | no high/critical vulnerable dependencies; no committed secrets | `npm audit --omit=dev --audit-level=high`; gitleaks |
| Prompt log | the PR author's `ai-prompts/<first name>.txt` has at least one new entry; no line in `ai-prompts/` removed or changed | PR checks job `Prompt log entry` |

## 15. AI setup in the repo

- **Coding skill (folder, committed)** at `docs/ai/skills/travel-platform/`: every detail coding agents need (modules, routes, data model, rules, workflow). Any tool can use it.
- **Chat skill (one Markdown file)** at `docs/ai/chat-skill/SKILL.md` (also uploaded as a skill on chat platforms): the complete project knowledge in one file, with a numbered outline so a model can jump to the right section. It holds every decision and its reason, the modules, the full data model, endpoints, rules, workflow, tickets, the course PDF summary and the requirements, plus an explicit list of what isn't decided. It answers only from that knowledge and tells the user to ask the team leader when something isn't decided or isn't covered. It is frozen as the team uses it; new decisions go only into this file.
- **AI review of PRs:** Copilot reviews every PR automatically (repo ruleset), briefed by `.github/copilot-instructions.md`, a checklist of the project's rules. Claude reviews on demand when the team leader comments `@claude review this` (`.github/workflows/claude.yml`, his Claude subscription via the `CLAUDE_CODE_OAUTH_TOKEN` secret; read-only, never pushes). Mechanical rules are CI scripts, not AI.
- **No contract or feature docs in README files.** A contract is documented by its types, the comment on each method and its fake; cross-module rules live in the data model §6. A README copy goes stale silently.
- **Shared rules live in the README ("Team rules")**, the single source for humans and agents. CI enforces what can be checked.
- **`AGENTS.example.md` (committed)** points to the README rules and the project skill, adds agent-only behaviours (no push/PR unless asked, follow `DESIGN.md` for UI, stop and tell the user to ask the team leader when something isn't decided, prompt logging), and ends with a personal section. Each member copies it to their own tool's file.
- **Gitignored (personal):** root `/AGENTS.md`, `/CLAUDE.md`, `/GEMINI.md`, `.claude/`, `.codex/`, `.cursor/`, `.gemini/`, personal skills.
- **Kept committed:** the framework-generated `backend/AGENTS.md` and `frontend/AGENTS.md` (pointers to version-matched framework docs). If anything in them conflicts with our rules, the README rules and the project skill win.

## 16. AI prompt log

- **Folder `ai-prompts/` with one file per member** (no merge conflicts between members): `kareem.txt`, `pierre.txt`, `mostafa.txt`, `aisha.txt`, `aya.txt`, `jana.txt`, `mokhtar.txt` (Mohamed Mokhtar Shaker).
- **The agent logs every prompt in the course's format** (PDF 11.1: `Date`, `Student`, `Tool`, `Related Requirement`, `Prompt`, `How the output was used`), with as little model thinking as possible: `Prompt` is the member's message copied exactly (an attached file, e.g. an execution file, is added as `[Attached: <file name>]` plus its full content, unchanged); `Related Requirement` is the ID in the current branch name, or `none`; `How the output was used` is one line stating what the turn did (files changed and commit, or "Answer only, no files changed"). Secrets, tokens and connection strings are replaced with `<removed>`. Append only; earlier entries are never edited.
- **Who is the current member:** set once in the member's local agent file (`I am <name>; my prompt log is ai-prompts/<first name>.txt`). No command or lookup per prompt. If it isn't set, the agent asks once and tells the member to add it.
- Chat tools without repo access: the member logs material prompts by hand (or asks the chat for a ready entry to paste).
- Kareem handles the course's `AI_PROMPTS.txt` requirement (the course names a single root file).

## 17. API contract

- **Next.js rewrite:** the browser calls `/api/*` and `/uploads/*` on the frontend's own origin; Next forwards them to the backend (`BACKEND_URL`). Cookies stay same-origin. Server Components call the backend directly and forward the cookie header.
- **One error shape** for every non-2xx response, produced by one global exception filter (Platform package): `{ statusCode, code, message, details?, path, timestamp }`. `details` lists field errors for validation (GEN-02).
- **Calendar dates** (`DateOnly` in the database) travel as `YYYY-MM-DD` strings in requests and responses. **Money** keeps the data model's names and minor units (`totalMinor`), formatted by the frontend.
- **Error codes live in one enum** (`common/errors/error-codes.ts`). New codes are added there in the same PR that uses them. Tests assert the status and the code, never the message wording.
- **Session deadlines and logout (ACC-06, ticket #27):** fix `sessions.absoluteExpiresAt` at login: 8 hours for admins, 7 days for other roles. Both refresh-cookie max age and server enforcement follow this role-at-login deadline. Every idle slide is capped there; sessions without it require a new login. Logout is public and idempotent: revoke the authenticated session, or fall back to the refresh cookie's hash, clear both cookies and return 204 even if already logged out. Other sessions are unaffected. Refresh clears cookies only on 401, not transient server failures.

## 18. Git rules

1. Branch from the latest `develop`; one ticket per branch: `<type>/<ID>-<description>`.
2. Never commit or push to `develop` or `main` directly (protected).
3. Keep your branch current by **merging** `develop` into it (no rebase, so no force-push).
4. Push your branch at least once a day; open a draft PR early if you like.
5. Before marking a PR ready: `npm run verify` passes in every app you changed, the template is filled, the title has the ID.
6. Kareem approves and merges. A PR needs CI green and his approval.
7. Merge with a **merge commit** (not squash), to keep TDD order and authorship in history.
8. Delete the branch after the merge.
9. If B needs A's code, wait for A's merge; if B only needs A's interface, start now against a fake.
10. Agents never push, open PRs, force-push, or touch `develop`/`main` unless the member explicitly asks; never commit `.env` files.
11. Releases: at each milestone Kareem merges `develop` → `main` and tags `m1` / `m2`.
12. **Setup phase works from `main`.** Just before the tickets start, Kareem fast-forwards `develop` to `main`, makes `develop` the default branch, and protects `develop` and `main`. From then on, all work branches from `develop`.

## 19. Tickets (M1, backend)

- **Sprint 1, contracts and foundation:** every package publishes the interface others call (stub + fake: `CTR-01`…`CTR-07`), plus the Platform foundation (`PLT-04` data model review and freeze, `PLT-05` common foundation, `PLT-06` event contracts and test support).
- **Sprint 2, features:** one ticket per requirement (tiny linked ones grouped). Every ticket depends only on Sprint 1 tickets or on its own package's tickets; other packages are used through fakes until merged.
- **Integration, end of Sprint 2 (Kareem):** demo seed (`PLT-08`), backend E2E journeys (`TST-01`), M1 release (`PLT-07`).
- **Backlog:** bonus requirements, the Azure runner (`PLT-02`), cloud deployment (`PLT-09`).
- **Keys:** the requirement ID where one fits; otherwise `CTR` (contract), `INV` (inventory), `PLT` (platform), `TST` (cross-module tests). Branch `<type>/<KEY>-<slug>`, PR title `<KEY>: <title>`.
- Tickets say **what** to build, the test levels, TDD, branch, PR title and dependencies; **how** is up to the owner. Dates are set by Kareem.
- Frontend tickets (M2) come later, once `DESIGN.md` is decided.

## 20. Audit event identity (GEN-07)

- `admin.action` requires a non-empty `eventId`, generated once per committed action and retained on delivery retries. Separate actions always receive new IDs.
- Audit derives its ObjectId `_id` from the first 12 bytes of SHA-256 of the event ID. The existing unique `_id` index deduplicates concurrent inserts without changing the frozen schema or indexes; an existing entry is never updated or deleted.
- Audit details retain only plain objects, arrays and primitive JSON values, with secret-looking keys stripped recursively. Unsupported nested objects are omitted rather than handed to BSON serialization with potentially secret-bearing fields or serialization hooks.
- This deduplication does not make in-process event delivery durable; an outbox or delivery retry mechanism is not introduced by GEN-07.

## Open items to discuss

**Priority: answer these first** (raised in Aisha's ACC-01 PR #126, merged as is on 15 Nov):

1. **Password cap: characters or bytes?** (raised in ACC-08 PR #139). The 17 Nov cap (§3) counts characters, but bcrypt counts UTF-8 bytes, so non-ASCII passwords can still collide: `"a1" + "é"×70` and `"a1" + "é"×35 + "x"×35` are both 72 characters and pass the rule, and a hash of the first accepts the second. Options: also require `Buffer.byteLength(password, 'utf8') <= 72`, or keep the character cap and document it.
2. **Registration response.** `POST /api/auth/register` returns `201 { user: MeDto }`, the same shape as login. Proposal: keep it.
3. **Auto-login after registering.** Currently no (the `auth.md` default); the frontend sends the user to the login page. Proposal: keep it.
4. **PLT-04 design calls** (`data-model.md` §8). PLT-04 is closed and its schemas are on develop. Proposal: record them as confirmed.

**Platform follow-ups (Kareem):**

- `common/events/app-events.service.spec.ts` and `events.spec.ts` fail to load in a full local run on Windows (`Cannot read properties of undefined (reading 'config')`); they pass alone and on CI (Linux). Reported in #126.

**Later:**

- A PDF summarising the important decisions and why (for the team and the evaluation), starting with "booking rules per module".
