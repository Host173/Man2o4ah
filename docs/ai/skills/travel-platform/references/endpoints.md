# Endpoints

From project PDF §8, plus the endpoints the requirements need but the PDF doesn't list (marked **added**). Keep these paths: graders test them in Swagger. `(B)` = bonus, only build it when asked.

**Module** = the module that owns the endpoint (`modules.md`); build it there, whatever the URL says.

Access: **Pub** = public (`@Public()`) · **User** = any logged-in account · **Own** = logged-in owner of the resource (service check, 404 otherwise) · **Adm** = admin · **AMod**/**HMod** = airline/hotel moderator, limited to their own provider.

Nest route order: declare static paths (`/mine`, `/search`, `/public/...`) **before** `/:id` in the same controller.

## Contents
Auth & accounts · Admin · Reference & supporting · Airlines & flights · Flight bookings · Hotels & rooms · Hotel bookings & reviews · Payments & refunds · Itineraries · Blog

## Auth & accounts
| Method | Path | Req | Access | Module |
|---|---|---|---|---|
| POST | /api/auth/register | ACC-01 | Pub | accounts |
| POST | /api/auth/login | ACC-04, ACC-05 | Pub | accounts |
| POST | /api/auth/refresh **added** | ACC-06, ACC-19 | Pub (refresh cookie) | accounts |
| POST | /api/auth/logout | ACC-06 | Pub (access or refresh cookie when present; idempotent 204) | accounts |
| GET | /api/auth/me | ACC-04, ACC-19 | User | accounts |
| PATCH | /api/auth/change-password | ACC-08, ACC-07a | User | accounts |
| GET | /api/users/me | ACC-09 | User | accounts |
| PATCH | /api/users/me | ACC-09 | User | accounts |
| DELETE | /api/users/me | ACC-12 | User (role USER) | accounts |
| GET | /api/auth/verify-email | ACC-02 (B) | Pub | accounts |
| POST | /api/auth/forgot-password · /api/auth/reset-password | ACC-07 (B) | Pub | accounts |

## Admin (all Adm)
| Method | Path | Req | Module |
|---|---|---|---|
| POST | /api/admin/moderators | ACC-13 | admin |
| GET | /api/admin/accounts | ACC-14 | admin |
| PATCH | /api/admin/accounts/:id/suspend · /reactivate | ACC-15, ACC-16 | admin |
| POST | /api/admin/users/:id/reset-password | ACC-07a | admin |
| GET | /api/admin/providers **added** | BE-01 (ACC-13, ACC-15) | admin |
| PATCH | /api/admin/providers/:type/:id/deactivate · /reactivate **added** (type = airline\|hotel) | ACC-15 | admin |
| GET | /api/admin/bookings | ACC-17 | admin |
| GET | /api/admin/reports | GEN-10 | admin |
| PATCH | /api/admin/reports/:id | GEN-10 | admin |
| DELETE | /api/admin/content/:type/:id | GEN-10 | admin |
| PATCH | /api/admin/content/:type/:id/hide **added** | GEN-10 | admin |
| GET | /api/admin/audit-logs | GEN-07 | admin |

## Reference & supporting (added)
| Method | Path | Req | Access | Module |
|---|---|---|---|---|
| GET | /api/countries · /api/cities · /api/currencies · /api/attractions | GEN-12 | Pub | reference-data |
| GET | /api/exchange-rates/latest | ITN-18 | Pub | fx |
| POST | /api/reports | GEN-09 | User | moderation |
| GET | /api/notifications · /api/notifications/unread-count | GEN-01 | User | notifications |
| PATCH | /api/notifications/:id/read · /api/notifications/read-all | GEN-01 | User | notifications |

## Airlines & flights
| Method | Path | Req | Access | Module |
|---|---|---|---|---|
| POST | /api/airlines | FLT-01 | Adm | flights |
| GET | /api/airlines/:id | FLT-01 | Pub | flights |
| PATCH | /api/airlines/:id | FLT-01 | AMod | flights |
| POST | /api/airlines/:id/logo **added** | FLT-01, GEN-08 | AMod | flights |
| PUT | /api/airlines/:id/baggage-policy | FLT-08 | AMod | flights |
| PUT | /api/airlines/:id/cancellation-policy | FLT-09 | AMod | flights |
| GET | /api/airlines/:id/flights **added** (moderator list) | FLT-05 | AMod | flights |
| GET | /api/airports | FLT-02 | Pub | reference-data |
| POST | /api/flights | FLT-03 | AMod | flights |
| GET | /api/flights/search | FLT-11, FLT-12, FLT-15 | Pub | flights |
| GET | /api/flights/:id | FLT-17 | Pub | flights |
| PATCH | /api/flights/:id | FLT-05 | AMod | flights |
| POST | /api/flights/:id/cancel | FLT-06 | AMod | flights |
| POST | /api/flights/:id/cabins | FLT-04 | AMod | flights |
| PATCH | /api/flights/:id/cabins/:cabinId | FLT-04, FLT-05 | AMod | flights |
| GET | /api/flights/:id/bookings | FLT-29 | AMod | flight-bookings |
| GET | /api/flights/:id/passengers/export | FLT-29 (CSV) | AMod | flight-bookings |

## Flight bookings
| Method | Path | Req | Access | Module |
|---|---|---|---|---|
| POST | /api/flight-bookings | FLT-19, FLT-21 (quote, no write) | User | flight-bookings |
| POST | /api/flight-bookings/hold | FLT-22 | User | flight-bookings |
| GET | /api/flight-bookings | FLT-25 | Own | flight-bookings |
| GET | /api/flight-bookings/:id | FLT-25 | Own | flight-bookings |
| GET | /api/flight-bookings/:id/refund-preview **added** | FLT-26 | Own | flight-bookings |
| POST | /api/flight-bookings/:id/cancel | FLT-26 | Own | flight-bookings |
| GET | /api/flight-bookings/:id/e-ticket | FLT-23 (PDF) | Own | flight-bookings |
| PATCH | /api/flight-bookings/:id/change-flight | FLT-27 (B) | Own | flight-bookings |
| PATCH | /api/flight-bookings/:id/seat | FLT-28 (B) | Own | flight-bookings |

## Hotels & rooms
| Method | Path | Req | Access | Module |
|---|---|---|---|---|
| POST | /api/hotels | HTL-01 | Adm | hotels |
| GET | /api/hotels/search | HTL-11, HTL-12 | Pub | hotels |
| GET | /api/hotels/:id | HTL-02 | Pub | hotels |
| PATCH | /api/hotels/:id | HTL-01 | HMod | hotels |
| POST | /api/hotels/:id/photos **added** · DELETE /api/hotels/:id/photos/:photoId | HTL-01, GEN-08 | HMod | hotels |
| PUT | /api/hotels/:id/policies (check-in/out times + tiers; PDF labels it HTL-08) | HTL-09, HTL-10 | HMod | hotels |
| GET | /api/hotels/:id/rooms **added** (moderator list) | HTL-03 | HMod | hotels |
| POST | /api/hotels/:id/rooms | HTL-03 | HMod | hotels |
| PATCH | /api/hotels/:id/rooms/:roomId | HTL-05, HTL-06 (deactivate) | HMod | hotels |
| DELETE | /api/hotels/:id/rooms/:roomId | HTL-06 | HMod | hotels |
| GET | /api/hotels/:id/rooms/available?checkIn&checkOut | HTL-15 | Pub | hotels |
| POST | /api/hotels/:id/rooms/:roomId/availability (add bookable range) | HTL-04 | HMod | hotels |
| PATCH | /api/hotels/:id/rooms/:roomId/availability `{op: SET_RANGES\|BLOCK\|UNBLOCK, ...}` | HTL-05, HTL-06 | HMod | hotels |
| GET | /api/hotels/:id/availability?from&to | HTL-08 | HMod | hotel-bookings |
| GET | /api/hotels/:id/reservations | HTL-22 | HMod | hotel-bookings |

## Hotel bookings & reviews
| Method | Path | Req | Access | Module |
|---|---|---|---|---|
| POST | /api/hotel-bookings | HTL-16, HTL-18 (creates the hold) | User | hotel-bookings |
| GET | /api/hotel-bookings | HTL-20 | Own | hotel-bookings |
| GET | /api/hotel-bookings/:id | HTL-20 | Own | hotel-bookings |
| GET | /api/hotel-bookings/:id/refund-preview **added** | HTL-21 | Own | hotel-bookings |
| POST | /api/hotel-bookings/:id/cancel | HTL-21 | Own | hotel-bookings |
| POST | /api/hotel-bookings/:id/review | HTL-23 | Own | hotel-bookings |
| PATCH | /api/reviews/:id · DELETE /api/reviews/:id | HTL-23 | Own | hotel-bookings |
| GET | /api/hotels/:id/reviews | HTL-24 | Pub | hotel-bookings |
| POST | /api/reviews/:id/reply | HTL-26 (B) | HMod | hotel-bookings |

## Payments & refunds
| Method | Path | Req | Access | Module |
|---|---|---|---|---|
| GET | /api/bookings/:type/:id/policies | PAY-02 | Own | payments |
| POST | /api/bookings/:type/:id/accept-policies | PAY-02 | Own | payments |
| POST | /api/payments | PAY-01 | Own (booking) | payments |
| POST | /api/payments/:id/retry | PAY-01 | Own | payments |
| GET | /api/payments/:id | PAY-01 | Own | payments |
| POST | /api/payments/webhook | PAY-01, PAY-03 | Pub (Stripe signature) | payments |
| GET | /api/refunds/:id | PAY-03 | Own | payments |

## Itineraries (Own unless noted)
| Method | Path | Req | Module |
|---|---|---|---|
| POST · GET | /api/itineraries | ITN-01, ITN-03 | itineraries |
| GET · PATCH · DELETE | /api/itineraries/:id | ITN-03, ITN-01, ITN-20 | itineraries |
| POST | /api/itineraries/:id/days | ITN-05 | itineraries |
| PATCH · DELETE | /api/itineraries/:id/days/:dayId | ITN-05, ITN-07 | itineraries |
| PATCH | /api/itineraries/:id/days/reorder `{dayIds}` (declare before `:dayId`) | ITN-08 | itineraries |
| POST | /api/itineraries/:id/days/:dayId/activities | ITN-10 | itineraries |
| PATCH · DELETE | /api/activities/:id | ITN-10 | itineraries |
| POST · DELETE | /api/activities/:id/images · /api/activities/:id/images/:imageId | ITN-12, GEN-08 | itineraries |
| POST | /api/itineraries/:id/days/:dayId/budgets | ITN-14 | itineraries |
| PATCH · DELETE | /api/budgets/:id | ITN-14 | itineraries |
| POST | /api/itineraries/:id/transport-costs | ITN-16 | itineraries |
| PATCH · DELETE | /api/transport-costs/:id | ITN-16 | itineraries |
| GET | /api/itineraries/:id/budget-summary | ITN-14, ITN-18 | itineraries |
| GET | /api/itineraries/public/search (Pub) | ITN-20, ITN-21 | itineraries |
| GET | /api/itineraries/public/:id (Pub) | ITN-21 | itineraries |
| POST | /api/itineraries/:id/clone (User, source must be public) | ITN-21 | itineraries |
| GET | /api/itineraries/:id/hotels?groupIndex&guests&rooms | ITN-25 (PDF labels it ITN-09) | itineraries |
| GET | /api/itineraries/:id/flights?origin&tripType | ITN-26 | itineraries |
| POST | /api/itineraries/:id/bookings | ITN-27 (B) | itineraries |
| GET | /api/itineraries/:id/pdf | ITN-28 (B) | itineraries |

## Blog
| Method | Path | Req | Access | Module |
|---|---|---|---|---|
| POST | /api/posts | BLG-01 | User | blog |
| GET | /api/posts?q&tag&page | BLG-02, BLG-09 | Pub | blog |
| GET | /api/posts/mine | BLG-03 | User | blog |
| GET | /api/posts/:id | BLG-02 (drafts only for the author) | Pub | blog |
| PATCH · DELETE | /api/posts/:id | BLG-04, BLG-08 | Own | blog |
| GET | /api/posts/:id/comments **added** | BLG-05 | Pub | blog |
| POST | /api/posts/:id/comments | BLG-05 | User | blog |
| PATCH · DELETE | /api/comments/:id | BLG-07 | Own | blog |
| POST · DELETE | /api/posts/:id/like | BLG-06 | User | blog |
| POST · DELETE | /api/posts/:id/images · /api/posts/:id/images/:imageId | BLG-10, GEN-08 | Own | blog |
| GET | /api/tags/:tag/posts | BLG-08 | Pub | blog |
| GET | /api/authors/:id | BLG-12 | Pub | blog |
| PATCH | /api/posts/:id/itinerary | BLG-13 (B) | Own | blog |
