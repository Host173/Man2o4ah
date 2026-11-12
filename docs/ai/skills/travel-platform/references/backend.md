# Backend (NestJS 12 ESM + Mongoose 9)

## Contents
1. Commands
2. ESM and Mongoose 9 gotchas
3. App setup (main.ts, AppModule)
4. Module recipe (schema → DTO → service → controller)
5. Validation and DTO rules
6. Errors
7. Pagination, filtering, sorting
8. Transactions
9. Ports and events
10. Scheduled jobs
11. File uploads (GEN-08)
12. Swagger
13. Don'ts

## 1. Commands (run in `backend/`)

`npm run start:dev` · `npm run build` · `npm run lint` (oxlint) · `npm run format` / `format:check` (Prettier) · `npm run typecheck` · `npm test` · `npm run test:cov` · `npm run verify` (everything CI runs) · `npm run seed:reference`.
New module: `npx nest g module modules/<name> --no-spec` (then controller/service the same way). Use the CLI; don't hand-write boilerplate it generates.

## 2. ESM and Mongoose 9 gotchas

- The backend is **ESM**. Match the import style of existing files (relative imports may need the `.js` suffix).
- Some Mongoose exports are types only at runtime: `import type { Connection, Model } from 'mongoose'`. A plain import of a type-only export crashes the built app.
- ObjectId props: `MongooseSchema.Types.ObjectId` (see `data-model.md` §3). `Types.ObjectId` silently becomes an untyped Mixed field.
- Mongoose 9 middleware must be `async` functions (no `next` parameter).
- Vitest doesn't type-check: `npm run typecheck` does, and CI requires it.

## 3. App setup

Already in place: global prefix `api`, global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, CORS for `FRONTEND_URL` with credentials, Swagger at `/api/docs`, env validation (`src/config/`), Mongoose via `MONGODB_URI`, health check at `/api/health`.

Added by the foundation (Platform package): `cookie-parser`, `rawBody: true` (Stripe webhook), the global exception filter, static `/uploads`, `EventEmitterModule.forRoot()`, `ScheduleModule.forRoot()`, global auth guards (Accounts package). Don't add these yourself in a feature branch.

Read config through `ConfigService` (or `process.env` only in `main.ts`). Never hardcode a connection string or secret.

## 4. Module recipe

**Schema:** follow `data-model.md` §3 exactly, with fields from `docs/database/data-model.md`.

**Module:**
```ts
@Module({
  imports: [MongooseModule.forFeature([{ name: Flight.name, schema: FlightSchema }]), ReferenceDataModule],
  controllers: [FlightsController],
  providers: [FlightsService, SeatInventory],
  exports: [FlightsService],              // the service only; never MongooseModule or a model
})
export class FlightsModule {}
```

**Service:** `constructor(@InjectModel(Flight.name) private readonly flightModel: Model<Flight>, private readonly referenceData: ReferenceDataService) {}`.
- `.lean()` for read-only queries; `await` every query.
- Throw domain errors (§6).
- Return plain objects or response DTOs, never documents containing secrets.
- Check ownership by querying with it (`findOne({ _id, userId })`), not by filtering afterwards.

**Controller:** route decorators, `@Roles(...)`/`@Public()`, DTO params, `@CurrentUser()`, one service call, return the result. No try/catch, no `res.status()`, no business logic.
```ts
@ApiTags('flights')
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Public() @Get('search')
  @ApiOperation({ summary: 'FLT-11 Search flights' })
  search(@Query() q: SearchFlightsQueryDto) { return this.flights.search(q); }

  @Roles(Role.AirlineModerator) @Patch(':id')
  @ApiOperation({ summary: 'FLT-05 Edit a flight' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateFlightDto, @CurrentUser() user: AuthUser) {
    return this.flights.update(id, dto, user);   // the service checks the moderator's airline owns it
  }
}
```
Declare static paths (`/search`, `/mine`, `/public/...`) **before** `/:id` in the same controller. `ParseObjectIdPipe` comes from `@nestjs/mongoose` and returns 400 for malformed IDs.

## 5. Validation and DTO rules

- Every body, query and param has a DTO with class-validator decorators that encode the requirement's limits (`@MaxLength(100)` for ITN-01, `@ArrayMaxSize(5)` for BLG-08, `@Min(1)`).
- Query numbers arrive as strings: `@Type(() => Number)` + `@IsInt()`. Dates: `@IsISO8601()` or a `YYYY-MM-DD` `@Matches`.
- Update DTOs: `PartialType(CreateXDto)` from **`@nestjs/swagger`**.
- Enums: reuse the `const` enum objects exported next to the schemas, so schema, DTO and Swagger agree.
- Never accept `userId`, `status`, `price`, `total`, `role`, `providerId` or `currency` from the client unless the requirement says the user chooses it. Derive them from the session and the database.
- Cross-field rules (arrival after departure, check-out after check-in, min ≤ max) go in the service and throw 400 `VALIDATION_FAILED` with the field name in `details`.

## 6. Errors

Throw Nest exceptions with a code from `common/errors/error-codes.ts`:
```ts
throw new ConflictException({ code: ErrorCode.SeatsUnavailable, message: 'Not enough seats left in Economy' });
```
| Status | Use |
|---|---|
| 400 | invalid input or broken rule |
| 401 | not logged in, bad credentials, expired session |
| 403 | logged in but wrong role |
| 404 | not found, **and** another user's private resource (ACC-11) |
| 409 | duplicates, overlaps, no seats/rooms, invalid status change |

The global filter turns everything into the shared shape (`api-contract.md` §3), maps validation errors to `details`, maps Mongo duplicate key `11000` to 409, and hides stack traces. Need a new code? Add it to the enum in the same PR.

## 7. Pagination, filtering, sorting

- `PaginationQueryDto { page = 1; limit = 10 }` (max 50) from `common/pagination`. Default page size 10 (GEN-05).
- Response: `{ items, page, limit, total, totalPages }`. Run `find().skip().limit()` and `countDocuments()` with the same filter in `Promise.all`.
- Sorting: whitelist `sortBy` with `@IsIn([...])` and map it to fields; never pass a client string into `.sort()`.
- Keyword search: case-insensitive regex on the input **escaped** (`escapeRegex` in `common`). Never `$where`, never raw client objects in a filter.

## 8. Transactions

Use them when one action writes several documents that must agree (hold, confirm, expire, cancel, room changes, clone).
```ts
constructor(@InjectConnection() private readonly conn: Connection) {}

const session = await this.conn.startSession();
try {
  await session.withTransaction(async () => {
    await this.seatInventory.hold(items, { session });              // another class: pass the session
    await this.bookingModel.create([doc], { session });             // array form with a session
  });
} finally { await session.endSession(); }
```
- Pass `{ session }` to every operation inside, including calls into other modules' services.
- `withTransaction` retries transient write conflicts, so the callback must be safe to run twice (no external calls).
- Keep Stripe/HTTP calls and event emits **after** the commit.

## 9. Ports and events

**Port** (owner defines the interface and exports a registry; implementer registers itself):
```ts
// payments/ports/payable-booking.port.ts — owned by payments
export interface PayableBooking {
  readonly bookingType: BookingType;
  getPayable(bookingId: string, userId: string): Promise<Payable>;
  getPolicies(bookingId: string, userId: string): Promise<BookingPolicies>;
}
// in flight-bookings — the implementer registers itself; payments never imports it
@Injectable()
export class FlightPayableBooking implements PayableBooking, OnModuleInit {
  readonly bookingType = BookingType.FLIGHT;
  constructor(private readonly registry: PayableBookingRegistry) {}
  onModuleInit() { this.registry.register(this); }
}
```
The owner exports a registry; implementers register in `onModuleInit`. Use the same pattern for every port. Contracts are published with **fakes** in `backend/test/fakes/` that `implements PublicApi<Service>`, so a drifting fake fails `npm run typecheck`.

**Event:**
```ts
this.events.emit(Events.FlightCancelled, { flightId: flight._id.toString() }); // this.events: AppEvents; after commit

@OnEvent(Events.FlightCancelled)
async onFlightCancelled({ flightId }: PayloadOf<typeof Events.FlightCancelled>) { /* idempotent, conditional updates */ }
```
Event names and payloads are fixed in `docs/database/data-model.md` §6.3 and typed in `backend/src/common/events/`: always use `Events.X` with `AppEvents.emit`, never a string literal or `EventEmitter2` directly. IDs travel as strings. A new event or payload field is a contract change (ask first).

## 10. Scheduled jobs

In the owning module (`modules.md` §7), with `@Cron(...)`. Every update filters on the old status (`{ status: 'pending_payment', holdExpiresAt: { $lte: now } }`) so two runs, or a job racing a request, can't double-apply. Business code re-checks expiry at the point of use; never assume a job already ran.

## 11. File uploads (GEN-08)

The `storage` module (Platform package) validates and saves files and returns an `ImageRef { _id, key }`. Feature modules call it; they don't use Multer directly.
- JPG/PNG only, ≤ 5 MB, random file names.
- The feature service enforces counts (≤ 5 per post, activity or hotel; 1 airline logo), stores the `ImageRef`, and asks storage to delete the file on removal.
- Responses compute the URL `/uploads/<key>`; it's never stored.

## 12. Swagger (Milestone 1 is graded here)

- `@ApiTags('<module>')` on every controller; `@ApiOperation({ summary: '<REQ-ID> <what it does>' })` on every route.
- Request and response DTOs documented, including error responses where useful.
- Cookie auth works in Swagger UI: call `POST /api/auth/login` there and the browser keeps the cookie.
- At each milestone, export `/api/docs-json` to `docs/api/openapi.json`.

## 13. Don'ts

- Logging passwords, hashes, tokens, card data or connection strings. Use Nest `Logger` without secrets.
- `any`, `@ts-ignore`, `@ts-expect-error`, lint-disable comments to make something pass.
- Returning raw Mongoose errors, or 200 with an error in the body.
- Business logic in guards beyond auth, role and must-change-password checks.
- Injecting another module's model, `populate` across modules, or `ref` in a schema.
