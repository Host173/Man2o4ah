# Review instructions for Man2o4ah

Man2o4ah is the GIU Software Project I "Travel Planning and Booking Platform": a NestJS 12 (ESM) backend with Mongoose 9 on MongoDB Atlas, and a Next.js 16 App Router frontend. Seven members each own one package of modules. The project's rules are in `docs/ai/skills/travel-platform/` (start at `SKILL.md`), every decision is in `docs/DECISIONS.md`, and the data model is `docs/database/data-model.md`. Review against those files, not against general habits.

## How to review

- Report **real problems only**: wrong behaviour, a broken rule below, a missing test the ticket needs, a contract that doesn't match the data model, or a comment that states something false. Skip style that Prettier, oxlint or ESLint already enforce.
- Start each comment with a severity: **Bug**, **Rule**, **Test**, **Docs** or **Nit**. Say what is wrong, why (name the rule or the data-model section), and the fix in one or two lines.
- The ticket key is in the branch name and PR title (e.g. `FLT-22`). Check the change against that ticket's requirement in `docs/ai/skills/travel-platform/references/requirements.md`. Flag anything the requirement names that the PR misses.
- If something isn't covered by the project's rules, say it's a question for the team leader instead of inventing a rule.

## Rules to check

**Module ownership**

- A PR changes only the modules of its author's package (`docs/DECISIONS.md` §11). Changes in another package's module need that owner's agreement: flag them.
- A module reads and writes only its own collections. Another module's data goes through its exported service, a port or an event. Never import another module's schema or model, never `populate` across modules, never add `ref` to a schema.

**Contracts (stubs, fakes, ports, events)**

- Service and port methods are typed with plain views (IDs as strings), never Mongoose documents.
- Every stub method throws `NotImplementedException` and its JSDoc names the requirement and the ticket that implements it. Check those IDs exist and match (no invented tickets, sprints or requirements).
- Fakes live in `backend/test/fakes/`, `implements PublicApi<Service>`, are exported from `index.ts`, and behave like the contract, including its errors.
- Ports are wired with a registry: the owner exports a registry; implementers call `registry.register(this)` in `onModuleInit`. The owner never imports implementers.
- Events: only `Events.X` with `AppEvents.emit(...)`, emitted after the transaction commits; never a string literal or `EventEmitter2` directly. Handlers are idempotent (conditional updates).

**Data and money**

- Only `SeatInventory` (flights) and `RoomNightInventory` (hotels) change inventory, and every inventory method takes the caller's `session` (required, not optional).
- Status changes are conditional updates (`{ _id, status: <expected> }`); the result is checked.
- Money is integer minor units (`priceMinor`, `totalMinor`); never floats. Prices and policies are snapshotted on the booking at hold time.
- Instants are UTC `Date`s; calendar dates are `DateOnly` (midnight UTC) via `common/dates`. ObjectId props use `MongooseSchema.Types.ObjectId`.

**API**

- Errors are Nest exceptions with a code from `backend/src/common/errors/error-codes.ts` (`new ConflictException({ code: ErrorCode.X, message })`). A new code must be added to the enum and to the list in `references/api-contract.md` in the same PR.
- DTOs validate every input (`class-validator`); lists use `PaginationQueryDto` and return `{ items, page, limit, total, totalPages }`.
- Ownership: another user's resource answers **404**, a wrong role **403**, no login **401**.
- User text in a regex goes through `escapeRegex` / `keywordRegex`.

**Tests**

- No PR without tests at the levels its ticket lists. Tickets marked TDD need the test commit before the code commit.
- Integration and API tests use `createTestApp`, `clearCollections` and `loginAs` from `backend/test/support/`; they never touch Atlas.
- Inventory and hold changes need a concurrency test that asserts the invariant (`Promise.allSettled`), not which request won.
- Never weaken, skip or delete a test to make a suite pass.
- Every `src/modules/**/*.service.ts` file needs at least 80% line coverage on its own.

**Process**

- The author's prompt log `ai-prompts/<first name>.txt` gets one entry per prompt (a CI check enforces at least one new entry). Entries are append-only.
- No secrets, tokens, connection strings or `.env` values anywhere in the diff or the description.
- Documentation and comments must be true: they are read by the team's AI agents.
