# Data model: how to use it

**The data model is not copied here.** The source of truth is the repo's `docs/database/data-model.md` (every collection, field, rule, index, inventory operation, lifecycle, port and event). Diagrams: `docs/database/class-diagrams.md`. Code: `backend/src/modules/<module>/schemas/`. A test (`backend/test/db/indexes.spec.ts`) fails if code indexes drift from the doc.

## Contents
1. How to look something up
2. Conventions you must follow
3. Schema pattern (copy this)
4. Changing the data model
5. Seeding

## 1. How to look something up

- One collection: `grep -n "#### \`flights\`" docs/database/data-model.md`, then read that section.
- Which module owns it: data-model §2 (table) or `modules.md` §2.
- Inventory operations: data-model §4. Lifecycles: §5. Ports and events: §6. Jobs: §7. Open design calls: §8.

## 2. Conventions (data-model §1, summarised)

- **Ownership:** only the owning module reads or writes a collection.
- **IDs:** app collections use `ObjectId`. Reference data uses the dataset's own ID as a string `_id` (`'CAI'`, `'cairo'`, `'EG'`, `'att-1'`), so references to it are strings (`cityId`, `airportId`, `countryCode`, `currency`).
- **Money:** integers in minor units, names end in `Minor`. Platform currency `USD`. Percentages are integers 0–100. Round half up.
- **Dates:** instants are UTC `Date`. Calendar dates are `DateOnly` (`Date` at `00:00:00.000Z`) via `common/dates`. Only `flights.departureLocalDate` is a `'YYYY-MM-DD'` string. Times of day are `'HH:mm'` strings. "Today" = the UTC date.
- **Enums:** lowercase `snake_case` values (`pending_payment`, `airline_moderator`). Error **codes** are different: UPPER_SNAKE (`api-contract.md` §3).
- **Names:** collections plural `snake_case` (`flight_bookings`); fields `camelCase`.
- **Visibility:** `isHidden` (admin) and `authorDeactivated` (event-driven). "Deleted user" is resolved when reading, never stored.
- **Snapshots:** bookings copy prices and policies at hold time and never recompute them.
- **Derived fields** (`departureLocalDate`, `durationMinutes`, `nights`, `dayCount`, `cityIds`, hotel `countryCode`) are set by the owning service on every write that affects them.

## 3. Schema pattern

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ collection: 'flights', timestamps: true })   // always set the collection name explicitly
export class Flight {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })   // NOT Types.ObjectId (becomes Mixed)
  airlineId!: Types.ObjectId;                                         // NO `ref`: no cross-module populate

  @Prop({ type: String, required: true })                             // reference-data id
  departureAirportId!: string;
}
export type FlightDocument = HydratedDocument<Flight>;
export const FlightSchema = SchemaFactory.createForClass(Flight);
FlightSchema.index({ departureAirportId: 1, arrivalAirportId: 1, departureLocalDate: 1, status: 1 });
```

Rules (a test enforces the first two): `MongooseSchema.Types.ObjectId` for ObjectIds; no `ref`; register schemas only in the owning module's `MongooseModule.forFeature`; never export the models; `select: false` on `passwordHash`.

## 4. Changing the data model

The schema is **frozen** after the team review. To change it:
1. Ask the team leader first.
2. One PR changes `docs/database/data-model.md`, the class diagram, the schema code and `indexes.spec.ts` together.
3. The team leader approves it.

An agent must never change the data model on its own initiative. If a task seems to need a new field, stop and say so.

## 5. Seeding

- `npm run seed:reference` (backend) imports `backend/seed-data/*.csv` exactly, upserts by `_id`, validates references first, and derives `currencies`. Safe to re-run. Never edit the CSVs or their IDs.
- The admin account (ACC-18) and demo data (`seed:demo`: sample airlines, flights, hotels) are separate scripts, added by their tickets. Demo data never touches reference data.
