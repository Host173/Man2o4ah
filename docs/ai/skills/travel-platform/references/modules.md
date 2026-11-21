# Modules, packages and how modules talk

Full contracts (every port method, every event payload) are in the repo's `docs/database/data-model.md` §6–7. This file is the map.

## Contents
1. Packages and owners
2. Modules
3. Folder layout
4. Who may call whom
5. Ports
6. Events
7. Background jobs
8. Where an endpoint lives

## 1. Packages and owners

Each package is owned by one person, backend (M1) and pages (M2). You only change modules your package owns. Owners of packages 2–7 are recorded in `docs/DECISIONS.md` §11 once chosen.

| # | Package | Modules | Owner |
|---|---|---|---|
| 1 | Platform & Payments | reference-data, payments, fx, notifications, audit, storage, `common` | Kareem (team leader; also reviews every PR) |
| 2 | Accounts & Auth | accounts | see DECISIONS §11 |
| 3 | Flights | flights | see DECISIONS §11 |
| 4 | Hotels | hotels | see DECISIONS §11 |
| 5 | Bookings | flight-bookings, hotel-bookings | see DECISIONS §11 |
| 6 | Itineraries | itineraries | see DECISIONS §11 |
| 7 | Community & Admin | blog, moderation, admin | see DECISIONS §11 |

Needs that cross packages: use a fake of the other side until it's merged (`testing.md` §5). If you need a change inside someone else's module, ask them; never edit it yourself.

## 2. Modules

| Module | Purpose | Owns (collections) |
|---|---|---|
| reference-data | Course datasets, read-only | countries, cities, airports, attractions, currencies |
| accounts | Register, login, lockout, sessions, profile, roles, moderator assignment | users, sessions |
| flights | Airlines, policies, flights, cabins, seat inventory (`SeatInventory`), flight search | airlines, flights |
| flight-bookings | Flight bookings, passengers, hold, confirm, cancel, e-ticket, moderator booking views | flight_bookings |
| hotels | Hotels, rooms, availability, blocks, room-night inventory (`RoomNightInventory`), hotel search | hotels, rooms, room_nights |
| hotel-bookings | Reservations, hold, confirm, cancel, reviews, room status view | hotel_reservations, reviews |
| payments | Stripe payments, webhook, refunds, policy acceptance | payments, refunds, policy_acceptances, stripe_webhook_events |
| itineraries | Days, cities, activities, images, budgets, transport, sharing, cloning | itineraries |
| fx | Daily exchange rates and conversion | exchange_rates |
| blog | Posts, tags, images, comments, likes, author page, deleted-post file cleanup | posts, comments, likes, post_image_cleanups |
| moderation | Reports on posts, comments, reviews, itineraries | reports |
| notifications | In-app and optional SMTP notifications (listens to events) | notifications, email_deliveries |
| audit | Append-only admin action log (listens to events) | audit_logs |
| admin | Admin endpoints; calls other modules' services | **none** |
| storage (infra) | Image upload validation, files on disk (GEN-08) | none |
| `common` (infra) | Guards, decorators, error filter and codes, pagination, dates, money | none |

A new feature extends the module whose data and rules it fits. A new module is created only for something totally different (new data no module owns), and only with the team leader's approval.

## 3. Folder layout (backend)

```
backend/src/
  main.ts  app.module.ts
  config/                 env validation
  common/                 database/ (shared embedded schemas) dates/ money/ errors/ guards/ decorators/ pagination/
  modules/<module>/
    <module>.module.ts  <module>.controller.ts  <module>.service.ts
    schemas/<name>.schema.ts
    dto/create-x.dto.ts  update-x.dto.ts  x-query.dto.ts  x.response.dto.ts
    ports/                (only the module that owns a port)
    <name>.spec.ts        tests next to the code they test
backend/test/support/     in-memory MongoDB helper, shared test fixtures
backend/seed-data/        course CSVs (never edit)
```

## 4. Who may call whom

| Module | May import services of |
|---|---|
| reference-data, storage, notifications, audit | — |
| accounts | reference-data, notifications (registers `EmailRecipientLookup` only) |
| fx | reference-data |
| flights | reference-data, storage |
| hotels | reference-data, storage |
| payments | — (uses the `PayableBooking` port) |
| flight-bookings | flights, payments, accounts (registers `ActiveBookingsCheck`) |
| hotel-bookings | hotels, payments, accounts (registers `ActiveBookingsCheck`) |
| itineraries | reference-data, fx, flights, hotels, accounts, storage |
| blog | accounts, itineraries, storage |
| moderation | — (uses the `ReportableContent` port) |
| admin | accounts, flights, hotels, flight-bookings, hotel-bookings, moderation, audit |

No cycles. A module exports **only its service** (and its port implementations), never its models. If you need something from a module that isn't on your list, that's a design question for the team leader.

## 5. Ports (dependency inversion)

When a lower module needs something from a higher one, the lower module owns an interface and the higher one implements it.

| Port (owned by) | Implemented by | Methods |
|---|---|---|
| `PayableBooking` (payments) | flight-bookings, hotel-bookings | `getPayable(bookingId, userId)`, `getPolicies(bookingId, userId)` |
| `ReportableContent` (moderation) | blog (post, comment), hotel-bookings (review), itineraries (itinerary) | `exists(id)`, `hide(id)`, `delete(id)` |
| `ActiveBookingsCheck` (accounts) | flight-bookings, hotel-bookings | `hasUpcomingConfirmed(userId)` |
| `EmailRecipientLookup` (notifications) | accounts | `getRecipient(userId)` -> `{ userId, email }` or null; via `EmailRecipientRegistry` |

Ports are registered with injection tokens defined in the owning module; implementers provide them. Until the implementer exists, the owner tests against a fake.

## 6. Events (`@nestjs/event-emitter`, in-process)

Handlers must be **idempotent** (conditional writes), because an event can be handled twice.
Audit derives its insert-only entry's `_id` from the stable `admin.action.eventId`;
duplicate delivery never inserts twice or modifies the original entry.

| Event | Emitted by | Handled by |
|---|---|---|
| `payment.succeeded {bookingType, bookingId}` | payments | booking modules → confirm, or late-payment refund |
| `flight-booking.expired`, `hotel-reservation.expired` | booking modules | payments → cancel the PaymentIntent |
| `flight-booking.confirmed` / `.cancelled`, `hotel-reservation.confirmed` / `.cancelled` | booking modules | notifications |
| `refund.updated` | payments | notifications |
| `flight.rescheduled` | flights | flight-bookings → sync copies, emit `flight-booking.rescheduled` → notifications |
| `flight.cancelled` | flights | flight-bookings → cancel confirmed (100% refund), expire pending |
| `user.deactivated`, `user.reactivated` | accounts | blog, itineraries → set `authorDeactivated` |
| `account.suspended`, `account.reactivated` | accounts | notifications |
| `provider.deactivated`, `provider.reactivated` | admin | notifications |
| `moderator.invited { eventId, userId }` | accounts, after creation persists | notifications email channel |
| `admin.action { eventId, actorId, action, target, details? }` | admin, moderation | audit |

Events carry recipients' user IDs; in-app handlers need no account lookup. The email channel resolves addresses through the Accounts-owned recipient adapter. Emit after the transaction commits.

`flight-booking.rescheduled`, account suspension/reactivation and provider deactivation/reactivation also carry `eventId`: a non-empty opaque ID generated once per committed change and reused for retries. Distinct changes use distinct IDs, regardless of whether earlier notifications were read (`data-model.md` §6.3).

## 7. Background jobs (`@nestjs/schedule`)

Each job lives in the module that owns the data and only uses conditional updates (safe if two app instances run it).

| Job | Module | Every |
|---|---|---|
| Expire flight holds (+ `SeatInventory.release`) | flight-bookings | 30 s |
| Complete flight bookings (last segment departed) | flight-bookings | 15 min |
| Mark flights departed | flights | 1 min |
| Expire hotel holds (+ `RoomNightInventory.release`) | hotel-bookings | 30 s |
| Complete stays (check-out date passed) | hotel-bookings | 1 h |
| Refresh exchange rates | fx | daily |
| Deliver queued email | notifications | 30 s |
| Retry post image cleanup | blog | 30 s |

## 8. Where an endpoint lives

The URL doesn't decide the module; ownership does. Endpoints that combine provider and booking data live in the **booking** module: `GET /api/flights/:id/bookings` and `/passengers/export` (FLT-29) in flight-bookings; `GET /api/hotels/:id/availability` (HTL-08), `/reservations` (HTL-22) and `/reviews` (HTL-24) in hotel-bookings. `endpoints.md` gives the module for every endpoint.
