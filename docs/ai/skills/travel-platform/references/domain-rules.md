# Domain rules (everything except bookings and payments)

Always confirm with the exact requirement text (`grep -n "<ID>" references/requirements.md`). These notes say **how** we implement it. Fields: `docs/database/data-model.md`.

## Contents
1. Time zones and dates
2. Exchange rates (fx)
3. Flights: management and search (flights)
4. Hotels: management, search, reviews (hotels, hotel-bookings)
5. Itineraries (itineraries)
6. Blog (blog)
7. Reports, moderation, audit (moderation, admin, audit)
8. Notifications (notifications)
9. Accounts and providers, admin side (admin)

## 1. Time zones and dates

- **Flights (FLT-03, GEN-06):** the moderator enters `departureLocal` / `arrivalLocal` as `YYYY-MM-DDTHH:mm`. Convert with the airport's zone: `DateTime.fromISO(local, { zone: airport.timeZone })`. Reject if `!dt.isValid`; store `dt.toUTC().toJSDate()`. Compare arrival > departure and departure > now in UTC. Store `departureLocalDate = dt.toISODate()` and `durationMinutes`; recompute both whenever times change.
- **Search by local date:** `departureLocalDate === query.date` (exact match on the stored string).
- **Display:** the backend returns UTC plus each airport's `timeZone`; the frontend formats with `Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' })`.
- **Calendar dates** (check-in/out, itinerary start, DOB, availability, room nights) are `DateOnly`. Use `common/dates` (`toDateOnly('2026-12-01')`, `addDays`, `daysBetween`, `isDateOnly`). "Today" = the current UTC date. Nights = every date from check-in up to but excluding check-out.

## 2. Exchange rates (ITN-18), module fx

- FXRatesAPI: `GET https://api.fxratesapi.com/latest?base=USD&currencies=EGP,AED,...` (`api_key` only if `FXRATES_API_KEY` is set). Success: `{ success: true, date, base, rates }`. Failure: `{ success: false, error, description }`.
- `FxService.refresh()` runs daily and at boot if today's document is missing. It inserts `exchange_rates { rateDate, base, rates, fetchedAt, source }` and never throws to callers: on any failure it logs and keeps the old data.
- `convert(amountMinor, from, to)` uses the newest document: `amount × rates[to] / rates[from]`, adjusted for each currency's `minorUnits` (JPY has 0), rounded half up. Unknown currency → `400 UNSUPPORTED_CURRENCY`. No rates at all → `503 RATES_UNAVAILABLE`.
- Responses with converted values include `{ displayCurrency, rateDate }`.
- Supported currencies = the `currencies` collection (reference-data). Booking prices are **never** converted (PAY-04). Only the backend calls the API.

## 3. Flights, module flights

- Management is scoped to `user.providerId` (the moderator's airline).
- Cabin classes are unique per flight (FLT-04). A new cabin starts with `availableSeats = totalSeats`.
- **Edits (FLT-05):**
  - Only `scheduled` flights can be edited.
  - Airports are locked once `hasBookings` is true.
  - Capacity changes go through `SeatInventory.changeCapacity` (never below held + booked).
  - Price edits never touch bookings (they hold snapshots).
  - Time changes recompute the derived fields and emit `flight.rescheduled`.
- **Cancel (FLT-06):** `scheduled → cancelled` (conditional update), `cancelledAt`, emit `flight.cancelled`. flight-bookings handles the bookings.
- **Status job (FLT-30):** `scheduled` with `departureAt ≤ now` → `departed`. Only `scheduled` flights are searchable, editable or bookable.
- **Search (FLT-11/12/15):**
  - Query: `{ from, to, date, adults, children, infants, cabinClass?, returnDate?, minPrice?, maxPrice?, sortBy: price|duration|departure }`.
  - Filter: airports, `departureLocalDate`, `status: 'scheduled'`, `departureAt > now`, airline active (look up the active airline IDs first, then `airlineId: { $in }`), and a cabin with `availableSeats ≥ adults + children` (`$elemMatch`, plus the class if given).
  - The price filter is inclusive on that cabin's `priceMinor`; `minPrice > maxPrice` → 400.
  - A round trip returns `{ outbound, inbound }`. No results → `[]`.
  - Itineraries reuse this search (ITN-26), so keep it a clean service method.

## 4. Hotels, modules hotels and hotel-bookings

- Rooms: `name` unique per hotel (HTL-03).
- **Availability (HTL-04/05):** inclusive `fromDate…toDate` ranges, normalised on save (sorted, adjacent ones merged, overlaps rejected) through `RoomNightInventory.setAvailability`, which rejects removing dates that have reservation nights.
- **Block, deactivate, delete (HTL-06):** through `RoomNightInventory`. Rejected if any reservation night from today on overlaps. Delete only while `hasEverBeenReserved` is false. An overlapping block is rejected.
- **Room status view (HTL-08), in hotel-bookings:** for each room and date, a `room_nights` hit means Booked (with the reservation's reference) or Blocked; otherwise Available if the date is inside an availability range.
- **Search (HTL-11/12/15), in hotels:**
  - Active hotels in the city or country.
  - Candidate rooms are active, with the whole stay inside one availability range and no `room_nights` for any night of the stay (`distinct('roomId', { hotelId, date: { $gte: checkIn, $lt: checkOut } })` gives the busy ones).
  - A hotel qualifies if it has ≥ `rooms` free rooms and the `rooms` largest occupancies cover `guests`. Its price is the cheapest qualifying room's price per night.
  - Then filter by price and rating, sort, and paginate. Unrated hotels drop out when `minRating` is set.
  - Itineraries reuse this search (ITN-25).
- **Reviews (HTL-23/24), in hotel-bookings:**
  - One per `completed` reservation, by its owner, text ≤ 1000. Newest first, paginated.
  - After create, edit, delete, hide or admin delete, aggregate the average and count over **non-hidden** reviews and call `HotelsService.setRatingSummary` (average to 1 decimal).

## 5. Itineraries, module itineraries

- **Days** are an embedded array: day number = index + 1; date = `startDate + index` days. Never store either. Max 60 days; each day needs a `cityId` (ITN-05/09).
- **Add a day:** append. **Delete a day (ITN-07):** remove it, its activities (and their image files), its budget entries, and the transport costs whose `dayId` is that day. **Reorder (ITN-08):** `PATCH /api/itineraries/:id/days/reorder { dayIds }` must be a permutation of the current IDs; replace the array in one update.
- Every write that changes `days` also recomputes `dayCount` and `cityIds` in the same update.
- **City groups (ITN-09)** are computed on read: consecutive days with the same city become `{ cityId, fromDay, toDay, dayCount, checkIn, checkOut (last date + 1), subtotal }`. ITN-25 reuses these dates for the hotel search.
- **Budget summary (ITN-14/18):** categories `food, accommodation, in_city_transport, activities` (activity costs count under activities), plus `intercity_transport` from transport costs. Totals per category, per day, per city group and overall, each amount converted to the viewer's `preferredCurrency` (§2) before summing. Return `{ displayCurrency, rateDate, total, byCategory, byDay, byCityGroup }`.
- **Visibility (ITN-20):** private by default. Public itineraries are read-only to others and appear in search; switching to private hides them at once.
- **Public search (ITN-21):** keyword on title, country names and city names (resolve matching codes and IDs through reference-data first, then query `countryCodes` / `cityIds`), filter by min/max `dayCount` and country or city. Exclude `isHidden` and `authorDeactivated`.
- **Clone (ITN-21):** a deep copy with **new** `_id`s everywhere, `visibility: private`, owner = the cloner, `clonedFrom { itineraryId, authorId }`, `transportCosts[].dayId` remapped, and **image files copied** to new keys through storage, so the clone survives the original being deleted.
- **Ownership:** every `/api/itineraries/:id/*`, `/api/activities/:id`, `/api/budgets/:id` and `/api/transport-costs/:id` route loads the parent with `{ _id, ownerId: user.id }` (or `{ 'days.activities._id': id, ownerId }`), otherwise 404.

## 6. Blog, module blog

- **Draft vs published (BLG-01):** public lists show only `published`, not `isHidden`, not `authorDeactivated`. Drafts are visible only to the author (`GET /api/posts/mine`).
- **Tags (BLG-08):** trim, lowercase, dedupe, ≤ 5, each ≤ 30 characters. `GET /api/tags/:tag/posts`.
- **Search (BLG-09):** `q` matches title or tags (escaped regex), or the author's name. Resolve the name through `AccountsService` to user IDs, then `authorId: { $in }`. Sort by `likeCount + commentCount` descending, then `publishedAt` descending (aggregation `$addFields`). Return an excerpt (~200 characters).
- **Likes (BLG-06):** insert into `likes` (a unique-index violation means already liked, so it's idempotent) and `$inc likeCount` only when the insert succeeded. Unlike: delete, and decrement only if something was deleted.
- **Comments (BLG-05/07):** 1–500 characters, chronological; authors edit and delete their own. `commentCount` counts visible comments (hiding one decrements it).
- **Author names** are fetched from accounts when reading, never stored. A deactivated author shows as "Deleted user" on comments.
- **Author page (BLG-12):** name, join date, published posts, public itineraries (through `ItinerariesService`).
- Deleting a post deletes its comments and likes and transactionally queues its image keys in `post_image_cleanups`. Files are deleted after commit; failures are logged and retried every 30 seconds, including across restarts. The committed post deletion returns 204 (data-model §1.6, §3.10, §7).

## 7. Reports, moderation, audit

- **Report (GEN-09), moderation:** `POST /api/reports { targetType, targetId, reason }`. The target must exist (`ReportableContent.exists`). A second report by the same user → `409 ALREADY_REPORTED`.
- **Resolve (GEN-10), admin → moderation:** `GET /api/admin/reports?status=open`; `PATCH /api/admin/reports/:id { action: dismiss|hide|delete }` applies the action once through `ReportableContent` and closes **all** open reports on that target (`dismissed`, `content_hidden` or `content_deleted`). `DELETE /api/admin/content/:type/:id` and `PATCH …/hide` act directly.
- Hidden content (`isHidden: true`) is visible only to its author and admins.
- **Audit (GEN-07):** admin and moderation emit `admin.action { actorId, action, target, details }` after each suspend, reactivate, moderator creation, password reset, provider (de)activation, report resolution, hide or delete. The audit module stores it (append-only). `GET /api/admin/audit-logs` is paginated and filterable by action and date.

## 8. Notifications (GEN-01)

The notifications module **listens to events** (`modules.md` §6); no module calls it to notify. Types: `booking_confirmed`, `booking_cancelled`, `refund_updated`, `flight_schedule_changed`, `flight_cancelled`, `account_suspended`, `account_reactivated`, `provider_deactivated`, `provider_reactivated`.
Endpoints: `GET /api/notifications` (paginated), `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`.

## 9. Accounts and providers, admin side

- **Moderator creation (ACC-13):** `{ name, email, role, providerId, temporaryPassword }`. The provider must exist (flights/hotels service) and match the role. accounts creates the user with `moderatorOf` and `mustChangePassword: true`.
- **Suspend / reactivate (ACC-15/16):** admin calls accounts (`auth.md` §8).
- **Provider deactivation (ACC-15):** admin calls flights/hotels to set `isActive: false` (hidden from search and booking; confirmed bookings stay valid), then emits `provider.deactivated` with the moderators' IDs.
- **Lists (ACC-14, ACC-17):** paginated, searchable, filterable as the requirement says. The booking list is read-only and merges flight and hotel bookings (two service calls combined and sorted by date, or a `type` filter).
