# Data Model — Travel Planning and Booking Platform

**Source of truth** for every MongoDB collection. Mongoose schemas are written from this file.
If the code and this file disagree, this file wins; fix the code or open a PR to change this file.
Changes go through the team leader (see `DECISIONS.md`).

Requirement IDs (ACC-01, FLT-22…) refer to the official Excel sheet.

---

## Contents

1. Global conventions
2. Collections at a glance
3. Collections by module
4. Inventory operations
5. Lifecycles (state machines)
6. Cross-module contracts (services, ports, events)
7. Background jobs
8. Decisions to confirm in team review

---

## 1. Global conventions

### 1.1 Ownership
- Every collection has exactly **one owning module**. Only that module's code reads or writes it.
- Other modules go through the owner's **exported service**. No cross-module `populate`.
- A reference to another module's document is just an ID field. MongoDB does not enforce it, so the writing service validates it (asks the owner "does it exist?") before saving.

### 1.2 IDs
- App collections use the default `_id: ObjectId`.
- **Reference-data collections use the dataset's own ID as `_id` (a string)**, exactly as in the CSV: `'EG'`, `'cairo'`, `'CAI'`, `'att-1'`. The graders test with these IDs.
- So references to reference data are **strings**: `countryCode`, `cityId`, `airportId`, `attractionId`, `currency`.
- Embedded subdocuments that are edited individually (cabins, days, activities, budget entries…) keep Mongoose's default `_id`.

### 1.3 Money
- Stored as **integers in minor units** (cents). Field names end in `Minor`: `priceMinor`, `amountMinor`. Never floats.
- **Platform currency** (PAY-04): `USD`, from config `PLATFORM_CURRENCY`. All flight/hotel prices, payments and refunds use it. Booking and payment documents still store `currency` explicitly.
- Itinerary amounts can be in any supported currency; their minor units follow that currency's `minorUnits` (JPY = 0, others = 2).
- Percentages are integers 0–100.
- Rounding: whenever a computation produces a fraction of a minor unit (infant fare, refund, FX conversion), round half up (`Math.round` on positive values).

### 1.4 Dates and times
| Kind | Stored as | Used for |
|---|---|---|
| Instant | `Date` (UTC) | flight departure/arrival, holds, timestamps |
| Calendar date | `DateOnly` = `Date` at `00:00:00.000Z` of that date | date of birth, check-in/out, room nights, availability, itinerary start date |
| Local calendar date | `string 'YYYY-MM-DD'` | only `flights.departureLocalDate` |
| Time of day | `string 'HH:mm'` (24h) | hotel check-in/out time, activity time |

- One helper module (`common/dates`) converts and validates `DateOnly`. Never build them with `new Date(localString)`.
- **"Today"** for date-only rules (check-in not in the past, cancel before check-in, stay completed) is the current **UTC** date.
- A hotel stay from `checkInDate` to `checkOutDate` covers the **nights** `checkInDate … checkOutDate − 1 day`. `nights = checkOutDate − checkInDate` in days.
- Flight times are entered in each airport's local time, converted with the airport's IANA `timeZone`, stored in UTC, and shown in local time (FLT-03, GEN-06).

### 1.5 Timestamps
All app collections use `{ timestamps: true }` (`createdAt`, `updatedAt`). Reference data does not.

### 1.6 Images (GEN-08)
- Files are stored **on the server's disk** and served by URL.
- Documents store `ImageRef = { _id: ObjectId, key: string }`. `key` is the stored file name.
- Responses compute the URL: `${PUBLIC_BASE_URL}/uploads/${key}`. The URL is never stored.
- Limits: JPG/PNG, ≤ 5 MB each; ≤ 5 per post, activity or hotel; 1 logo per airline.
- Removing an image (or its parent) deletes the file.

### 1.7 Visibility flags
| Field | On | Set by | Meaning |
|---|---|---|---|
| `isHidden: boolean` | posts, comments, reviews, itineraries | admin (GEN-10) | Visible only to the author and admins |
| `authorDeactivated: boolean` | posts, itineraries | event `user.deactivated` / `user.reactivated` (ACC-12) | Hidden from everyone else while the author is deactivated |

Comments and reviews of a deactivated user stay visible but show **"Deleted user"**. That is resolved when reading (the accounts service returns the user's status), not stored.

### 1.8 Naming
- Collections: plural `snake_case` (`flight_bookings`). Fields: `camelCase`.
- Enum values: lowercase `snake_case` (`pending_payment`).

### 1.9 Transactions
- Atlas (and the test memory server) run as a replica set, so multi-document transactions are available.
- Use them where two writes must succeed together: creating a hold, confirming, expiring, cancelling (booking status + inventory), hotel room changes.
- Run them with `session.withTransaction(...)`, which retries on transient write conflicts. Pass the `session` into every service call that writes.

---

## 2. Collections at a glance

| # | Collection | Module | Purpose |
|---|---|---|---|
| 1 | `countries` | reference-data | Dataset: countries |
| 2 | `cities` | reference-data | Dataset: cities |
| 3 | `airports` | reference-data | Dataset: airports with time zones |
| 4 | `attractions` | reference-data | Dataset: attractions |
| 5 | `currencies` | reference-data | Supported currencies (derived from countries) |
| 6 | `users` | accounts | All accounts: users, admins, moderators |
| 7 | `sessions` | accounts | Refresh-token sessions, idle expiry |
| 8 | `airlines` | flights | Airline profile + baggage and cancellation policies |
| 9 | `flights` | flights | Flights with embedded cabins and seat counters |
| 10 | `flight_bookings` | flight-bookings | Bookings with segments and passengers (a hold is a `pending_payment` booking) |
| 11 | `hotels` | hotels | Hotel profile + policy + rating summary |
| 12 | `rooms` | hotels | Bookable rooms with availability ranges |
| 13 | `room_nights` | hotels | One document per occupied room per night (inventory) |
| 14 | `hotel_reservations` | hotel-bookings | Reservations with rooms and guests |
| 15 | `reviews` | hotel-bookings | One review per completed reservation |
| 16 | `payments` | payments | Stripe PaymentIntent per booking |
| 17 | `refunds` | payments | Stripe refund per cancelled booking |
| 18 | `policy_acceptances` | payments | Policy acceptance timestamp per booking |
| 19 | `stripe_webhook_events` | payments | Processed webhook event IDs (idempotency) |
| 20 | `itineraries` | itineraries | Itinerary with embedded days, activities, budgets, transport costs |
| 21 | `exchange_rates` | fx | Daily cached rates |
| 22 | `posts` | blog | Blog posts |
| 23 | `comments` | blog | Comments on posts |
| 24 | `likes` | blog | One like per user per post |
| 25 | `reports` | moderation | User reports on content |
| 26 | `notifications` | notifications | In-app notifications |
| 27 | `audit_logs` | audit | Append-only log of admin actions |

`admin` owns no collection. `storage` owns no collection (files on disk). `common` owns no collection.

Field tables use: **Req** = required; `→ x` = reference to collection `x` (by ID).

---

## 3. Collections by module

### 3.1 reference-data

Seeded from the course CSVs (GEN-12, FLT-02). **Read-only** to the app: no endpoint creates, edits or deletes these documents.

**Seed rules**
- Import every row exactly: no renaming, trimming of IDs, filtering or "cleaning".
- Upsert by `_id`, so re-running the seed creates no duplicates and changes nothing.
- Validate before writing: every city's `countryCode`, airport's `cityId`/`countryCode`, and attraction's `cityId` must exist. If any is missing, stop with an error naming the row. Write nothing.

#### `countries` — CSV `code,name,currency`
| Field | Type | Req | Rules |
|---|---|---|---|
| `_id` | string | ✓ | CSV `code`, e.g. `'EG'` |
| `name` | string | ✓ | |
| `currency` | string → currencies | ✓ | e.g. `'EGP'` |

#### `cities` — CSV `city_id,name,country_code`
| Field | Type | Req | Rules |
|---|---|---|---|
| `_id` | string | ✓ | CSV `city_id`, e.g. `'new_york'` |
| `name` | string | ✓ | |
| `countryCode` | string → countries | ✓ | |

Indexes: `{ countryCode: 1 }`

#### `airports` — CSV `iata_code,name,city_id,country_code,time_zone`
| Field | Type | Req | Rules |
|---|---|---|---|
| `_id` | string | ✓ | CSV `iata_code`, e.g. `'CAI'` |
| `name` | string | ✓ | |
| `cityId` | string → cities | ✓ | |
| `countryCode` | string → countries | ✓ | |
| `timeZone` | string | ✓ | IANA zone, e.g. `'Africa/Cairo'` |

Indexes: `{ cityId: 1 }`, `{ countryCode: 1 }`

#### `attractions` — CSV `attraction_id,name,city_id`
| Field | Type | Req | Rules |
|---|---|---|---|
| `_id` | string | ✓ | CSV `attraction_id`, e.g. `'att-1'` |
| `name` | string | ✓ | |
| `cityId` | string → cities | ✓ | |

Indexes: `{ cityId: 1 }`

#### `currencies` — derived
The supported currencies (GEN-12, ITN-18) are the distinct `currency` values in `countries.csv`, plus `PLATFORM_CURRENCY` if missing. Names and minor units come from a fixed table in the seed code.

| Field | Type | Req | Rules |
|---|---|---|---|
| `_id` | string | ✓ | ISO 4217 code, e.g. `'USD'` |
| `name` | string | ✓ | e.g. `'US Dollar'` |
| `minorUnits` | int | ✓ | 0–3; `JPY` = 0, the rest of the current set = 2 |

---

### 3.2 accounts

#### `users`
| Field | Type | Req | Rules |
|---|---|---|---|
| `name` | string | ✓ | trimmed, 1–100 chars |
| `email` | string | ✓ | trimmed, lowercased, valid email, **unique** |
| `passwordHash` | string | ✓ | salted hash only (GEN-13); `select: false` |
| `role` | enum `user \| admin \| airline_moderator \| hotel_moderator` | ✓ | default `user` |
| `status` | enum `active \| suspended \| deactivated` | ✓ | default `active` |
| `phone` | string | | optional; validated format |
| `preferredCurrency` | string → currencies | ✓ | default `PLATFORM_CURRENCY` (ACC-09, ITN-18) |
| `moderatorOf` | `{ providerType: enum airline\|hotel, providerId: ObjectId }` | cond. | **required for moderator roles, absent otherwise**; `providerType` must match the role (ACC-13) |
| `mustChangePassword` | boolean | ✓ | default `false`; `true` after admin reset or moderator creation (ACC-07a, ACC-13) |
| `termsAcceptedAt` | Date | cond. | required when a guest self-registers (ACC-01) |
| `failedLoginAttempts` | int | ✓ | default 0 (ACC-05) |
| `lockedUntil` | Date \| null | | set to now + 15 min on the 5th consecutive failure |

Indexes: `{ email: 1 }` unique · `{ role: 1, status: 1, createdAt: -1 }` (ACC-14) · `{ 'moderatorOf.providerId': 1 }`

Rules
- Admins exist only through the seed (ACC-18). Registration always creates `role: user`.
- Password rules (≥ 8 chars, ≥ 1 letter, ≥ 1 digit) are checked on the plain password before hashing (DTO), not in the schema.
- Failed login: `$inc failedLoginAttempts` atomically; on reaching 5 set `lockedUntil` and reset the counter. A successful login resets both.
- `suspended` and `deactivated` users cannot log in (ACC-04, ACC-12, ACC-15, ACC-16). A suspended user's bookings stay valid.

#### `sessions`
One document per logged-in device. Implements refresh-token revocation and the 30-minute idle timeout (ACC-06, ACC-19).

| Field | Type | Req | Rules |
|---|---|---|---|
| `userId` | ObjectId → users | ✓ | |
| `refreshTokenHash` | string | ✓ | SHA-256 of the refresh token; the token itself is never stored |
| `lastActivityAt` | Date | ✓ | |
| `expiresAt` | Date | ✓ | `lastActivityAt + 30 min` |

Indexes: `{ userId: 1 }` · `{ expiresAt: 1 }` **TTL** (`expireAfterSeconds: 0`)

Rules
- Every authenticated request checks the session exists and `expiresAt > now` (TTL deletion can lag ~60 s), then slides `lastActivityAt`/`expiresAt` (at most once per minute per session).
- Logout deletes the session. Password change, admin password reset, suspension and deactivation delete **all** of the user's sessions.
- Tokens travel only in httpOnly, Secure, SameSite cookies (ACC-19).

---

### 3.3 flights

#### `airlines`
| Field | Type | Req | Rules |
|---|---|---|---|
| `name` | string | ✓ | 1–100 chars |
| `code` | string | ✓ | uppercase `[A-Z0-9]{2,3}`, **unique** |
| `logo` | ImageRef | | at most one (GEN-08) |
| `isActive` | boolean | ✓ | default `true` (ACC-15) |
| `baggagePolicy` | `BaggagePolicy` | ✓ | default `{ extraBagPriceMinor: null, maxExtraBagsPerPassenger: 0 }` (FLT-08) |
| `cancellationPolicy` | `{ tiers: CancellationTier[] }` | ✓ | default `{ tiers: [] }` (FLT-09) |

`BaggagePolicy`: `extraBagPriceMinor` int > 0 or null · `maxExtraBagsPerPassenger` int ≥ 0. If `maxExtraBagsPerPassenger > 0`, `extraBagPriceMinor` is required.

`CancellationTier` (shared shape, also used by hotels): `daysBefore` int ≥ 0 · `refundPercent` int 0–100. **`daysBefore` unique within the array.**
Refund rule: pick the tier with the highest `daysBefore` ≤ days remaining; none → 0 %.

Indexes: `{ code: 1 }` unique · `{ isActive: 1 }`

#### `flights`
| Field | Type | Req | Rules |
|---|---|---|---|
| `airlineId` | ObjectId → airlines | ✓ | |
| `flightNumber` | string | ✓ | trimmed, uppercase |
| `departureAirportId` | string → airports | ✓ | ≠ `arrivalAirportId` |
| `arrivalAirportId` | string → airports | ✓ | |
| `departureAt` | Date (UTC) | ✓ | not in the past at creation |
| `arrivalAt` | Date (UTC) | ✓ | > `departureAt` |
| `departureLocalDate` | string `YYYY-MM-DD` | ✓ | **derived**: `departureAt` in the departure airport's time zone; recomputed whenever `departureAt` changes |
| `durationMinutes` | int | ✓ | **derived**: `arrivalAt − departureAt` |
| `status` | enum `scheduled \| cancelled \| departed` | ✓ | default `scheduled` (FLT-30) |
| `hasBookings` | boolean | ✓ | default `false`; set `true` by `SeatInventory.hold` (blocks airport changes, FLT-05) |
| `cabins` | `Cabin[]` | ✓ | 0–4 items; `cabinClass` unique within the flight (FLT-04) |
| `cancelledAt` | Date | | set on FLT-06 |

`Cabin` (embedded, has `_id`)
| Field | Type | Rules |
|---|---|---|
| `cabinClass` | enum `economy \| premium_economy \| business \| first` | unique per flight |
| `totalSeats` | int | > 0 |
| `availableSeats` | int | ≥ 0 |
| `heldSeats` | int | ≥ 0 |
| `bookedSeats` | int | ≥ 0 |
| `priceMinor` | int | > 0, per seat |
| `freeBags` | int | ≥ 0, free bag count per passenger |
| `maxBagWeightKg` | number | > 0, per bag (also the limit for extra bags, FLT-08) |

**Invariant: `totalSeats = availableSeats + heldSeats + bookedSeats`.** Only `SeatInventory` (section 4.1) changes the four counters. A new cabin starts with `availableSeats = totalSeats`, the others 0.

Indexes
- `{ airlineId: 1, flightNumber: 1, departureLocalDate: 1 }` **unique** (FLT-03; cancelled flights keep their number for that date)
- `{ departureAirportId: 1, arrivalAirportId: 1, departureLocalDate: 1, status: 1 }` (search, FLT-11)
- `{ airlineId: 1, departureAt: 1 }`
- `{ status: 1, departureAt: 1 }` (departed job)

Rules
- Only `scheduled` flights with `departureAt > now` of an **active** airline are searchable and bookable. Only `scheduled` flights are editable (FLT-30).
- Airports cannot change once `hasBookings` is true. Price changes never touch existing bookings (they keep snapshots).

---

### 3.4 flight-bookings

#### `flight_bookings`
A **seat hold is a booking in `pending_payment`** (FLT-22). There is no separate holds collection.

| Field | Type | Req | Rules |
|---|---|---|---|
| `userId` | ObjectId → users | ✓ | owner (ACC-11) |
| `reference` | string | cond. | set on confirmation (FLT-23); `FB` + 6 uppercase alphanumerics; unique |
| `status` | enum `pending_payment \| confirmed \| completed \| expired \| cancelled` | ✓ | GEN-11, section 5.1 |
| `tripType` | enum `one_way \| round_trip` | ✓ | |
| `segments` | `FlightSegment[]` | ✓ | 1 for one way, 2 for round trip (outbound first) |
| `passengers` | `Passenger[]` | ✓ | ≥ 1 |
| `seatCount` | int | ✓ | adults + children (infants take no seat); same on every segment |
| `pricing` | `{ fareTotalMinor, baggageTotalMinor, totalMinor, currency }` | ✓ | computed once at hold time, never recomputed |
| `holdExpiresAt` | Date | ✓ | `createdAt + 10 min` |
| `firstDepartureAt` | Date | ✓ | = outbound `departureAt` (kept in sync) |
| `lastDepartureAt` | Date | ✓ | = last segment `departureAt` (kept in sync) |
| `confirmedAt` / `expiredAt` / `completedAt` | Date | | set on that transition |
| `cancellation` | `Cancellation` | | set when cancelled |

`FlightSegment` (embedded, has `_id`)
| Field | Type | Rules |
|---|---|---|
| `direction` | enum `outbound \| return` | |
| `flightId` | ObjectId → flights | |
| `cabinId` | ObjectId | `_id` of the cabin inside that flight |
| `cabinClass` | enum (as `Cabin`) | copy |
| `airlineId` | ObjectId → airlines | copy (never changes) |
| `flightNumber` | string | copy (never changes) |
| `departureAirportId`, `arrivalAirportId` | string → airports | copies (cannot change once booked) |
| `departureAt`, `arrivalAt` | Date | copies, **synced** on event `flight.rescheduled` |
| `fareMinor` | int | **price snapshot** per seat at hold time |
| `policy` | `SegmentPolicy` | **policy snapshot** at hold time |

`SegmentPolicy`: `cancellationTiers: CancellationTier[]`, `freeBags`, `maxBagWeightKg`, `extraBagPriceMinor` (0 if none), `maxExtraBagsPerPassenger`.

`Passenger` (embedded, has `_id`)
| Field | Type | Rules |
|---|---|---|
| `type` | enum `adult \| child \| infant` | must match age on the outbound departure date: adult 12+, child 2–11, infant < 2 (FLT-12) |
| `fullName` | string | 1–100 chars |
| `dateOfBirth` | DateOnly | not in the future |
| `documentNumber` | string | passport/ID, 3–30 chars |
| `extraBagCount` | int | ≥ 0, ≤ `maxExtraBagsPerPassenger` of **every** segment |
| `extraBagWeightKg` | number | weight per extra bag; > 0 when `extraBagCount > 0`; ≤ `maxBagWeightKg` of every segment |

Booking rules (FLT-12, FLT-19): ≥ 1 adult; infants ≤ adults.

Pricing (computed at hold time, per segment, then summed):
- fares = `seatCount × fareMinor` + `infants × round(fareMinor × 10 / 100)`
- baggage = `sum(extraBagCount) × policy.extraBagPriceMinor`
- `totalMinor = fareTotalMinor + baggageTotalMinor`; `currency = PLATFORM_CURRENCY`

`Cancellation` (shared shape, also used by hotel reservations)
| Field | Type | Rules |
|---|---|---|
| `cancelledAt` | Date | |
| `cancelledBy` | enum `user \| provider` | |
| `refundPercent` | int | 0–100 |
| `refundAmountMinor` | int | `round(totalMinor × refundPercent / 100)` |

Refund for a user cancellation uses the **outbound segment's snapshot tiers** with days remaining until the outbound departure (FLT-12a, FLT-26). Provider cancellation is always 100 % (FLT-06).

Indexes
- `{ reference: 1 }` unique, partial `{ reference: { $type: 'string' } }`
- `{ userId: 1, firstDepartureAt: -1 }` (FLT-25)
- `{ 'segments.flightId': 1, status: 1 }` (FLT-29, flight cancel/reschedule)
- `{ status: 1, holdExpiresAt: 1 }` (expiry job)
- `{ status: 1, lastDepartureAt: 1 }` (completion job)
- `{ status: 1, createdAt: -1 }` (admin list, ACC-17)

---

### 3.5 hotels

#### `hotels`
| Field | Type | Req | Rules |
|---|---|---|---|
| `name` | string | ✓ | 1–150 chars |
| `address` | string | ✓ | 1–300 chars |
| `cityId` | string → cities | ✓ | |
| `countryCode` | string → countries | ✓ | **derived** from the city; stored for search by country |
| `description` | string | | ≤ 5000 chars |
| `photos` | ImageRef[] | ✓ | 0–5 (GEN-08) |
| `starRating` | int | | 1–5 |
| `amenities` | string[] | ✓ | each trimmed, 1–50 chars, unique |
| `checkInTime` | string `HH:mm` | ✓ | default `'14:00'` (HTL-09) |
| `checkOutTime` | string `HH:mm` | ✓ | default `'12:00'` |
| `cancellationPolicy` | `{ tiers: CancellationTier[] }` | ✓ | default `{ tiers: [] }`; `daysBefore` = days before check-in (HTL-10) |
| `isActive` | boolean | ✓ | default `true` (ACC-15) |
| `ratingSummary` | `{ average: number \| null, count: int }` | ✓ | default `{ average: null, count: 0 }`; written only through `HotelsService.setRatingSummary` (HTL-23) |

Indexes: `{ cityId: 1, isActive: 1 }` · `{ countryCode: 1, isActive: 1 }` · `{ 'ratingSummary.average': -1 }`

#### `rooms`
| Field | Type | Req | Rules |
|---|---|---|---|
| `hotelId` | ObjectId → hotels | ✓ | |
| `name` | string | ✓ | room number/name, trimmed; **unique within the hotel** (HTL-03) |
| `type` | string | ✓ | 1–50 chars, free text (e.g. "Deluxe King") |
| `beds` | int | ✓ | ≥ 1 |
| `maxOccupancy` | int | ✓ | ≥ 1 |
| `pricePerNightMinor` | int | ✓ | > 0 |
| `isActive` | boolean | ✓ | default `true` (HTL-06) |
| `availability` | `{ _id, fromDate: DateOnly, toDate: DateOnly }[]` | ✓ | bookable nights, **both ends inclusive**; non-overlapping; adjacent ranges merged on save; sorted (HTL-04) |
| `hasEverBeenReserved` | boolean | ✓ | default `false`; set by `RoomNightInventory.reserve`; deletion allowed only while `false` (HTL-06) |
| `inventoryVersion` | int | ✓ | default 0; incremented by every operation in section 4.2 (forces write conflicts between concurrent changes to the same room) |

Indexes: `{ hotelId: 1, name: 1 }` unique · `{ hotelId: 1, isActive: 1 }`

#### `room_nights`
**One document = one room is taken for one night.** A night with no document is free (if the room is active and the night is inside an availability range).

| Field | Type | Req | Rules |
|---|---|---|---|
| `roomId` | ObjectId → rooms | ✓ | |
| `hotelId` | ObjectId → hotels | ✓ | copy, for per-hotel queries |
| `date` | DateOnly | ✓ | the night |
| `kind` | enum `reservation \| blocked` | ✓ | |
| `reservationId` | ObjectId → hotel_reservations | cond. | required when `kind = reservation` |
| `blockId` | ObjectId | cond. | required when `kind = blocked`; groups the nights of one blocked range (HTL-06) |

Indexes: `{ roomId: 1, date: 1 }` **unique** (this is the double-booking guarantee) · `{ hotelId: 1, date: 1 }` · `{ reservationId: 1 }` · `{ blockId: 1 }`

Rules
- Reservation nights exist while the reservation is `pending_payment`, `confirmed` or `completed`. They are deleted when it becomes `expired` or `cancelled`.
- Only `RoomNightInventory` (section 4.2) writes this collection.

---

### 3.6 hotel-bookings

#### `hotel_reservations`
A **room hold is a reservation in `pending_payment`** (HTL-18).

| Field | Type | Req | Rules |
|---|---|---|---|
| `userId` | ObjectId → users | ✓ | owner |
| `hotelId` | ObjectId → hotels | ✓ | all rooms belong to this hotel (HTL-16) |
| `reference` | string | cond. | set on confirmation (HTL-17); `HR` + 6 uppercase alphanumerics; unique |
| `status` | enum `pending_payment \| confirmed \| completed \| expired \| cancelled` | ✓ | GEN-11 |
| `checkInDate` | DateOnly | ✓ | not before today (UTC) |
| `checkOutDate` | DateOnly | ✓ | > `checkInDate` |
| `nights` | int | ✓ | **derived** ≥ 1 |
| `rooms` | `ReservedRoom[]` | ✓ | ≥ 1, `roomId` unique |
| `totalMinor` | int | ✓ | sum of `subtotalMinor` |
| `currency` | string | ✓ | `PLATFORM_CURRENCY` |
| `policySnapshot` | `{ cancellationTiers: CancellationTier[], checkInTime, checkOutTime }` | ✓ | copied at hold time |
| `holdExpiresAt` | Date | ✓ | `createdAt + 10 min` |
| `confirmedAt` / `expiredAt` / `completedAt` | Date | | |
| `cancellation` | `Cancellation` | | `cancelledBy` is always `user` today (HTL-21) |

`ReservedRoom` (embedded, has `_id`)
| Field | Type | Rules |
|---|---|---|
| `roomId` | ObjectId → rooms | |
| `roomName`, `roomType` | string | snapshots |
| `pricePerNightMinor` | int | **price snapshot** at hold time |
| `adults` | int | ≥ 0 |
| `childAges` | int[] | each 0–17 |
| `subtotalMinor` | int | `nights × pricePerNightMinor` |

Rules (HTL-16): ≥ 1 adult in the reservation; every room has ≥ 1 guest; `adults + childAges.length ≤ room.maxOccupancy`.
Refund (HTL-21): snapshot tiers, days from today until `checkInDate`, applied to `totalMinor`. Cancellation only before the check-in date. No partial cancellation.

Indexes
- `{ reference: 1 }` unique, partial `{ reference: { $type: 'string' } }`
- `{ userId: 1, checkInDate: -1 }` (HTL-20)
- `{ hotelId: 1, checkInDate: 1 }` (HTL-22)
- `{ status: 1, holdExpiresAt: 1 }` (expiry job)
- `{ status: 1, checkOutDate: 1 }` (completion job)
- `{ status: 1, createdAt: -1 }` (admin list)

#### `reviews`
| Field | Type | Req | Rules |
|---|---|---|---|
| `reservationId` | ObjectId → hotel_reservations | ✓ | **unique** (one review per reservation, HTL-23) |
| `hotelId` | ObjectId → hotels | ✓ | copy |
| `userId` | ObjectId → users | ✓ | must own the reservation |
| `rating` | int | ✓ | 1–5 |
| `text` | string | | ≤ 1000 chars |
| `isHidden` | boolean | ✓ | default `false` (GEN-10) |

Indexes: `{ reservationId: 1 }` unique · `{ hotelId: 1, createdAt: -1 }` (HTL-24) · `{ userId: 1 }`

Rules: only for a `completed` reservation. After create, edit, delete, hide or delete-by-admin, recompute the hotel's average and count over **non-hidden** reviews and call `HotelsService.setRatingSummary` (average rounded to 1 decimal).

---

### 3.7 payments

#### `payments`
Stores only what PAY-01 allows: Stripe ID, amount, currency, status (+ links).

| Field | Type | Req | Rules |
|---|---|---|---|
| `bookingType` | enum `flight \| hotel` | ✓ | |
| `bookingId` | ObjectId | ✓ | → `flight_bookings` or `hotel_reservations` |
| `userId` | ObjectId → users | ✓ | |
| `stripePaymentIntentId` | string | ✓ | unique |
| `amountMinor` | int | ✓ | = booking total |
| `currency` | string | ✓ | |
| `status` | enum `pending \| failed \| succeeded \| canceled` | ✓ | section 5.3 |

Indexes: `{ stripePaymentIntentId: 1 }` unique · `{ bookingType: 1, bookingId: 1 }` unique (one PaymentIntent per booking; retries reuse it) · `{ userId: 1 }`

#### `refunds`
| Field | Type | Req | Rules |
|---|---|---|---|
| `paymentId` | ObjectId → payments | ✓ | |
| `bookingType` | enum `flight \| hotel` | ✓ | |
| `bookingId` | ObjectId | ✓ | |
| `userId` | ObjectId → users | ✓ | |
| `stripeRefundId` | string | | set once Stripe accepts the request |
| `amountMinor` | int | ✓ | > 0 (a 0 refund creates no document, PAY-03) |
| `currency` | string | ✓ | |
| `reason` | enum `user_cancellation \| provider_cancellation \| late_payment` | ✓ | `late_payment` = payment succeeded after the hold expired |
| `status` | enum `pending \| refunded \| failed` | ✓ | PAY-03 |

Indexes: `{ bookingType: 1, bookingId: 1 }` unique · `{ stripeRefundId: 1 }` unique, partial `{ stripeRefundId: { $type: 'string' } }` · `{ userId: 1 }`

#### `policy_acceptances`
| Field | Type | Req | Rules |
|---|---|---|---|
| `bookingType` | enum `flight \| hotel` | ✓ | |
| `bookingId` | ObjectId | ✓ | |
| `userId` | ObjectId → users | ✓ | |
| `acceptedAt` | Date | ✓ | PAY-02 timestamp |

Indexes: `{ bookingType: 1, bookingId: 1 }` unique.
The accepted policy is the booking's own snapshot, so it is not copied here. Creating a payment requires an acceptance.

#### `stripe_webhook_events`
| Field | Type | Req | Rules |
|---|---|---|---|
| `_id` | string | ✓ | Stripe event ID |
| `type` | string | ✓ | e.g. `payment_intent.succeeded` |
| `receivedAt` | Date | ✓ | |

Indexes: `{ receivedAt: 1 }` TTL 30 days.
Insert first; a duplicate-key error means the event was already processed, so return 200 and do nothing.

---

### 3.8 itineraries

#### `itineraries`
Everything the itinerary owns is embedded. Day order **is** the array order.

| Field | Type | Req | Rules |
|---|---|---|---|
| `ownerId` | ObjectId → users | ✓ | |
| `title` | string | ✓ | trimmed, 1–100 chars (ITN-01) |
| `countryCodes` | string[] → countries | ✓ | ≥ 1, unique |
| `startDate` | DateOnly | ✓ | |
| `visibility` | enum `private \| public` | ✓ | default `private` (ITN-01, ITN-20) |
| `isHidden` | boolean | ✓ | default `false` |
| `authorDeactivated` | boolean | ✓ | default `false` |
| `clonedFrom` | `{ itineraryId: ObjectId, authorId: ObjectId }` | | attribution (ITN-21); kept even if the original is deleted |
| `days` | `Day[]` | ✓ | 0–60 (ITN-05) |
| `transportCosts` | `TransportCost[]` | ✓ | default `[]` (ITN-16) |
| `dayCount` | int | ✓ | **derived** = `days.length` (search by duration) |
| `cityIds` | string[] | ✓ | **derived** = distinct `days[].cityId` (search by city) |

**Never stored:** day numbers (= index + 1), day dates (= `startDate` + index days), city groups, budget totals. They are computed when reading, so add/delete/reorder can't leave them stale (ITN-07, ITN-08, ITN-09).

`Day` (has `_id`)
| Field | Type | Rules |
|---|---|---|
| `cityId` | string → cities | required (ITN-09) |
| `notes` | string | ≤ 2000 chars |
| `activities` | `Activity[]` | |
| `budgetEntries` | `BudgetEntry[]` | |

`Activity` (has `_id`, ITN-10, ITN-12)
| Field | Type | Rules |
|---|---|---|
| `name` | string | required, 1–100 chars |
| `description` | string | ≤ 1000 chars |
| `time` | string `HH:mm` | optional |
| `cost` | `{ amountMinor: int ≥ 0, currency: string → currencies }` | optional; counted under Activities |
| `images` | ImageRef[] | 0–5 |
| `attractionId` | string → attractions | optional; must be in the day's city |

`BudgetEntry` (has `_id`, ITN-14): `category` enum `food \| accommodation \| in_city_transport \| activities` · `amountMinor` int ≥ 0 · `currency` → currencies · `note` ≤ 200 chars.

`TransportCost` (has `_id`, ITN-16): `dayId` (= a `days[]._id` of this itinerary) · `mode` enum `flight \| train \| bus \| car \| ferry \| other` · `fromCityId`, `toCityId` → cities · `amountMinor` int ≥ 0 · `currency` → currencies.

Budget summary (ITN-14, ITN-18), computed: categories `food, accommodation, in_city_transport, activities, intercity_transport`; totals per category, per day, per city group and overall, converted to the user's `preferredCurrency` with the latest `exchange_rates`, showing the rate date.

Indexes
- `{ ownerId: 1, updatedAt: -1 }` (ITN-03)
- `{ visibility: 1, isHidden: 1, authorDeactivated: 1, updatedAt: -1 }` (public search)
- `{ countryCodes: 1 }` · `{ cityIds: 1 }`
- `{ 'days.activities._id': 1 }` · `{ 'days.budgetEntries._id': 1 }` · `{ 'transportCosts._id': 1 }` (endpoints address them by their own ID)

Rules
- Every write that changes `days` recomputes `dayCount` and `cityIds` in the same update.
- Deleting a day deletes its activities (and their image files), budget entries, and the transport costs whose `dayId` is that day.
- Clone (ITN-21): deep copy with new `_id`s everywhere, `visibility: private`, `isHidden: false`, `clonedFrom` set, `transportCosts[].dayId` remapped to the new day IDs, **image files copied** to new keys (so the clone survives the original's deletion).
- Deleting an itinerary deletes its image files; clones are unaffected.

---

### 3.9 fx

#### `exchange_rates`
| Field | Type | Req | Rules |
|---|---|---|---|
| `rateDate` | DateOnly | ✓ | UTC date of the fetch; **unique** |
| `base` | string | ✓ | currency the rates are relative to |
| `rates` | Map<string, number> | ✓ | one entry per supported currency (incl. base = 1); every value > 0 |
| `fetchedAt` | Date | ✓ | |
| `source` | string | ✓ | `'fxratesapi'` |

Indexes: `{ rateDate: -1 }` unique.

Rules (ITN-18): fetched once per day; on API failure keep using the latest document and show its date; if no document exists yet, conversion returns a clear "rates unavailable" error. Convert `amount × rates[to] / rates[from]`, adjusting minor units, round half up. The API key stays on the server.

---

### 3.10 blog

#### `posts`
| Field | Type | Req | Rules |
|---|---|---|---|
| `authorId` | ObjectId → users | ✓ | |
| `title` | string | ✓ | 1–150 chars |
| `body` | string | ✓ | 1–20000 chars |
| `tags` | string[] | ✓ | 0–5; trimmed, lowercased, 1–30 chars, unique (BLG-08) |
| `images` | ImageRef[] | ✓ | 0–5 |
| `status` | enum `draft \| published` | ✓ | |
| `publishedAt` | Date | cond. | set the first time it is published |
| `likeCount` | int | ✓ | default 0, `$inc` with likes |
| `commentCount` | int | ✓ | default 0, counts **visible** comments |
| `isHidden` | boolean | ✓ | default `false` |
| `authorDeactivated` | boolean | ✓ | default `false` |

Indexes: `{ status: 1, isHidden: 1, authorDeactivated: 1, publishedAt: -1 }` · `{ authorId: 1, updatedAt: -1 }` · `{ tags: 1, status: 1 }`

Search (BLG-09) orders by `likeCount + commentCount` descending, then `publishedAt` descending (computed in the aggregation, not stored). Deleting a post deletes its comments, likes and image files.

#### `comments`
| Field | Type | Req | Rules |
|---|---|---|---|
| `postId` | ObjectId → posts | ✓ | post must be published |
| `authorId` | ObjectId → users | ✓ | |
| `body` | string | ✓ | trimmed, 1–500 chars (BLG-05) |
| `isHidden` | boolean | ✓ | default `false` |

Indexes: `{ postId: 1, createdAt: 1 }` · `{ authorId: 1 }`

#### `likes`
| Field | Type | Req | Rules |
|---|---|---|---|
| `postId` | ObjectId → posts | ✓ | |
| `userId` | ObjectId → users | ✓ | |

Indexes: `{ postId: 1, userId: 1 }` **unique** (BLG-06) · `{ userId: 1 }`
Like = insert + `$inc likeCount`; a duplicate key means already liked. Unlike = delete + `$inc -1` only if a document was deleted.

---

### 3.11 moderation

#### `reports`
| Field | Type | Req | Rules |
|---|---|---|---|
| `reporterId` | ObjectId → users | ✓ | |
| `targetType` | enum `post \| comment \| review \| itinerary` | ✓ | GEN-09 |
| `targetId` | ObjectId | ✓ | must exist (checked through the content port) |
| `reason` | string | ✓ | 1–500 chars |
| `status` | enum `open \| dismissed \| content_hidden \| content_deleted` | ✓ | default `open` |
| `resolvedBy` | ObjectId → users | | admin |
| `resolvedAt` | Date | | |

Indexes: `{ reporterId: 1, targetType: 1, targetId: 1 }` **unique** (once per item) · `{ status: 1, createdAt: -1 }` · `{ targetType: 1, targetId: 1 }`

Resolving a report applies the action once and closes **all** open reports on the same target with the same status.

---

### 3.12 notifications

#### `notifications`
| Field | Type | Req | Rules |
|---|---|---|---|
| `userId` | ObjectId → users | ✓ | recipient |
| `type` | enum (below) | ✓ | |
| `title` | string | ✓ | ≤ 100 chars |
| `message` | string | ✓ | ≤ 500 chars |
| `entity` | `{ type: string, id: string }` | | what to open, e.g. `{ type: 'flight_booking', id }` |
| `readAt` | Date \| null | | null = unread |

`type` (GEN-01): `booking_confirmed`, `booking_cancelled`, `refund_updated`, `flight_schedule_changed`, `flight_cancelled`, `account_suspended`, `account_reactivated`, `provider_deactivated`, `provider_reactivated`.

Indexes: `{ userId: 1, readAt: 1, createdAt: -1 }`

---

### 3.13 audit

#### `audit_logs`
Append-only: no update or delete anywhere in the code (GEN-07). `createdAt` only (`timestamps: { createdAt: true, updatedAt: false }`).

| Field | Type | Req | Rules |
|---|---|---|---|
| `actorId` | ObjectId → users | ✓ | the admin |
| `action` | enum (below) | ✓ | |
| `target` | `{ type: string, id: string }` | ✓ | e.g. `{ type: 'user', id }` |
| `details` | object | | small, no secrets (never passwords) |

`action`: `account_suspended`, `account_reactivated`, `moderator_created`, `password_reset`, `provider_deactivated`, `provider_reactivated`, `report_resolved`, `content_hidden`, `content_deleted`.

Indexes: `{ createdAt: -1 }` · `{ actorId: 1, createdAt: -1 }` · `{ 'target.type': 1, 'target.id': 1 }`

---

## 4. Inventory operations

These classes are the **only** code that changes inventory. Each method takes the caller's `session` and runs inside the caller's transaction. A method that cannot apply its change throws a domain error, which aborts the whole transaction. "Fails with" names the `ErrorCode` enum key (PascalCase key, UPPER_SNAKE value: `SeatsUnavailable` = `'SEATS_UNAVAILABLE'`; the enum is in the API contract). `InventoryCorrupted` (500) means the counters' invariant broke, which should never happen.

### 4.1 `SeatInventory` (flights module)
`items` = list of `{ flightId, cabinId, seats }`. Every update matches the cabin with `$elemMatch` and changes it with the positional `$`, so check + change happen in **one atomic document update**.

| Method | Filter (besides `_id` and cabin `_id`) | Change | Fails with |
|---|---|---|---|
| `hold(items)` | flight `status: scheduled`, `departureAt > now`; cabin `availableSeats ≥ seats` | `availableSeats −seats`, `heldSeats +seats`, `hasBookings = true` | `SeatsUnavailable` |
| `confirm(items)` | cabin `heldSeats ≥ seats` | `heldSeats −seats`, `bookedSeats +seats` | `InventoryCorrupted` |
| `release(items)` | cabin `heldSeats ≥ seats` | `heldSeats −seats`, `availableSeats +seats` | `InventoryCorrupted` |
| `returnBooked(items)` | cabin `bookedSeats ≥ seats` | `bookedSeats −seats`, `availableSeats +seats` | `InventoryCorrupted` |
| `changeCapacity(flightId, cabinId, newTotal, expectedTotal)` | cabin `totalSeats = expectedTotal`, `availableSeats ≥ expectedTotal − newTotal` | `totalSeats` and `availableSeats` both `+ (newTotal − expectedTotal)` | `CapacityBelowReserved` or `ConcurrentChange` |

Example (`hold`, one item):
```js
flights.updateOne(
  { _id: flightId, status: 'scheduled', departureAt: { $gt: now },
    cabins: { $elemMatch: { _id: cabinId, availableSeats: { $gte: seats } } } },
  { $inc: { 'cabins.$.availableSeats': -seats, 'cabins.$.heldSeats': seats },
    $set: { hasBookings: true } },
  { session })
// modifiedCount === 0  →  throw SeatsUnavailable
```
A round trip holds both segments in the same transaction, so it never holds one without the other.

### 4.2 `RoomNightInventory` (hotels module)
Two mechanisms together:
- **Unique index `{ roomId, date }`** makes two reservations (or a reservation and a block) for the same night impossible.
- **"Touching" the room** (`$inc inventoryVersion`) inside the transaction makes concurrent changes to the same room conflict, so a reservation can't slip past an availability change or deactivation happening at the same moment. The losing transaction retries and re-checks.

| Method | Steps | Fails with |
|---|---|---|
| `reserve(hotelId, roomIds, checkIn, checkOut, reservationId)` | for each room: update `{ _id, hotelId, isActive: true, availability: { $elemMatch: { fromDate ≤ checkIn, toDate ≥ checkOut − 1 day } } }` with `$inc inventoryVersion`, `$set hasEverBeenReserved: true` (no match → fail); then `insertMany` one night per room per night (duplicate key → fail) | `RoomsUnavailable` (whole request rejected, HTL-18) |
| `release(reservationId)` | `deleteMany({ reservationId })` | — |
| `block(roomId, fromDate, toDate)` | touch room; `insertMany` nights `kind: blocked` with a new `blockId` (duplicate key → fail) | `OverlapsReservationOrBlock` (HTL-06) |
| `unblock(blockId)` | touch room; `deleteMany({ blockId })` | — |
| `setAvailability(roomId, ranges)` | touch room; reject if any reservation night from today on falls outside the new ranges; normalise (sort, merge adjacent, reject overlaps); save | `AvailabilityHasReservations` (HTL-05) |
| `deactivate(roomId)` / `delete(roomId)` | touch room; reject if any reservation night from today on exists; delete also requires `hasEverBeenReserved = false` | `RoomHasReservations` / `RoomWasReserved` |

---

## 5. Lifecycles

Every transition is **one conditional update**: `updateOne({ _id, status: <from> }, { $set: { status: <to>, … } })`. If it matches nothing, another process already moved the document, and the caller must not continue. This is what makes the hold-expiry job and the payment webhook safe when they race.

### 5.1 Flight booking and hotel reservation (GEN-11)
```
pending_payment ──payment succeeded──▶ confirmed ──end of trip/stay──▶ completed
       │                                   │
       └──hold expired──▶ expired          └──user/provider cancels──▶ cancelled
```
| Transition | Triggered by | Inventory (same transaction) |
|---|---|---|
| create `pending_payment` | user proceeds to payment | `SeatInventory.hold` / `RoomNightInventory.reserve` |
| → `confirmed` | event `payment.succeeded` | `SeatInventory.confirm` / nothing (nights stay) |
| → `expired` | expiry job when `holdExpiresAt ≤ now`; also flight cancelled (FLT-06) | `SeatInventory.release` / `RoomNightInventory.release` |
| → `cancelled` | user (FLT-26, HTL-21) or flight cancelled (FLT-06) | `SeatInventory.returnBooked` / `RoomNightInventory.release` |
| → `completed` | job: flight `lastDepartureAt ≤ now`; hotel `checkOutDate < today` | none |

### 5.2 Flight (FLT-30)
`scheduled → departed` (job, `departureAt ≤ now`) · `scheduled → cancelled` (moderator, FLT-06).

### 5.3 Payment
`pending → succeeded` (verified webhook) · `pending → failed` (webhook) · `failed → pending` (retry) · `pending|failed → canceled` (hold expired, PaymentIntent cancelled).
**Late success:** if `payment.succeeded` arrives after the booking is already `expired`, the booking is not confirmed and a full refund with `reason: late_payment` is created.

### 5.4 Refund
`pending → refunded | failed` (Stripe result). Each change notifies the user (PAY-03).

### 5.5 Report
`open → dismissed | content_hidden | content_deleted`.

---

## 6. Cross-module contracts

### 6.1 Who calls whom (allowed imports)
| Module | May call services of |
|---|---|
| reference-data, storage, notifications, audit | — |
| accounts | reference-data |
| fx | reference-data |
| flights | reference-data, storage |
| hotels | reference-data, storage |
| payments | — (uses the payable port) |
| flight-bookings | flights, payments |
| hotel-bookings | hotels, payments |
| itineraries | reference-data, fx, flights, hotels, accounts, storage |
| blog | accounts, itineraries, storage |
| moderation | — (uses the reportable-content port) |
| admin | accounts, flights, hotels, flight-bookings, hotel-bookings, moderation, audit |

No cycles. When a module needs something from a module "above" it, it defines a **port** (an interface it owns) and the other module implements it (dependency inversion).

A URL path does not decide the module. Endpoints that combine provider data with booking data live in the **booking** module, because only it may depend on both: `GET /api/flights/:id/bookings` and `/passengers/export` (FLT-29) in flight-bookings; `GET /api/hotels/:id/availability` (HTL-08) and `/reservations` (HTL-22) in hotel-bookings.

### 6.2 Ports
| Port (owned by) | Implemented by | Methods |
|---|---|---|
| `PayableBooking` (payments) | flight-bookings, hotel-bookings | `getPayable(bookingId, userId)` → `{ amountMinor, currency, status, holdExpiresAt }`; `getPolicies(bookingId, userId)` |
| `ReportableContent` (moderation) | blog (post, comment), hotel-bookings (review), itineraries (itinerary) | `exists(id)`, `hide(id)`, `delete(id)` |
| `ActiveBookingsCheck` (accounts) | flight-bookings, hotel-bookings | `hasUpcomingConfirmed(userId)` (blocks ACC-12) |

### 6.3 Events (in-process, `@nestjs/event-emitter`)
Handlers are **idempotent**: they use conditional updates, so handling the same event twice changes nothing.

| Event | Emitted by | Handled by |
|---|---|---|
| `payment.succeeded {bookingType, bookingId}` | payments | flight-bookings / hotel-bookings → confirm (or late-payment refund) |
| `flight-booking.expired`, `hotel-reservation.expired` | booking modules | payments → cancel the PaymentIntent |
| `flight-booking.confirmed`, `…cancelled`, `hotel-reservation.confirmed`, `…cancelled` `{bookingId, userId, reference}` | booking modules | notifications |
| `refund.updated {refundId, userId, status}` | payments | notifications |
| `flight.rescheduled {flightId, departureAt, arrivalAt}` | flights | flight-bookings → sync copies, then emits `flight-booking.rescheduled {bookingId, userId}` → notifications |
| `flight.cancelled {flightId}` | flights | flight-bookings → cancel confirmed (100 % refund), expire pending |
| `user.deactivated`, `user.reactivated {userId}` | accounts | blog, itineraries → set `authorDeactivated` |
| `account.suspended`, `account.reactivated {userId}` | accounts | notifications |
| `provider.deactivated`, `provider.reactivated {providerType, providerId, moderatorIds}` | admin | notifications |
| `admin.action {actorId, action, target, details}` | admin, moderation | audit |

---

## 7. Background jobs (`@nestjs/schedule`)
Each job lives in the module that owns the data and uses conditional updates, so two app instances running the same job is safe.

| Job | Module | Every | Does |
|---|---|---|---|
| Expire flight holds | flight-bookings | 30 s | `pending_payment` with `holdExpiresAt ≤ now` → `expired` + `SeatInventory.release` |
| Complete flight bookings | flight-bookings | 15 min | `confirmed` with `lastDepartureAt ≤ now` → `completed` |
| Mark flights departed | flights | 1 min | `scheduled` with `departureAt ≤ now` → `departed` |
| Expire hotel holds | hotel-bookings | 30 s | `pending_payment` with `holdExpiresAt ≤ now` → `expired` + `RoomNightInventory.release` |
| Complete stays | hotel-bookings | 1 h | `confirmed` with `checkOutDate < today` → `completed` |
| Refresh rates | fx | daily | fetch FXRatesAPI, insert today's `exchange_rates` |

Sessions need no job (TTL index).

---

## 8. Decisions to confirm in team review
These are the calls this design makes where the requirements are silent or ambiguous. Each module owner confirms or challenges the ones in their area.

1. Platform currency is **USD**.
2. "Today" for date-only rules is the **UTC** date.
3. Refunds use the **policy snapshot taken at hold time**, not the provider's current policy (the user accepted that version, PAY-02).
4. Extra baggage is chosen once per passenger and applies to **every segment**, charged per segment at that segment's airline price.
5. A flight booking is **completed** when its last segment has departed.
6. Pending bookings on a cancelled flight become **expired** (the only legal exit from `pending_payment`).
7. A cancelled flight **keeps its flight number** for that date (no re-creating the same number that day).
8. Airline `code` is 2–3 uppercase letters/digits and unique.
9. Every room in a hotel reservation must have **at least one guest**.
10. Blocking a range that overlaps an existing block is **rejected** (not merged).
11. Hidden reviews are **excluded** from the hotel's average rating.
12. `commentCount` counts only **visible** comments.
13. Activities may optionally link an **attraction** from the dataset (the only use of `attractions`).
14. A payment that succeeds **after** the hold expired is refunded in full automatically.
15. Hotel default check-in/out times are 14:00 / 12:00 until the moderator sets them.
