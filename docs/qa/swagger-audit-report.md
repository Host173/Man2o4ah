# Swagger audit — 2026-11-21, develop 233f86d

Re-run with `cd backend && npm run test:audit`. Raw results land in `backend/test/audit/out/coverage.json` and `smoke.json` (gitignored). Bonus requirements are out of scope.

## Summary
104 mandatory requirements: 97 API-testable, 7 frontend-only.
✅ 87 pass · ❌ 10 fail (MISSING 0, HIDDEN 9, BROKEN 1, DOCS 0), plus 7 operation-level failures that belong to no single requirement (BROKEN 6, DOCS 1).
Routes from endpoints.md in Swagger: 130/130. Leftover stubs: 1.

Raw results: coverage has 732 checks with 11 failed; smoke has 539 probes (224 requirement probes, 315 guard probes) with 7 failed. The C8 stub check and the HTL-08 probe share one cause, so the tables below have 17 rows for 18 failed results.

## Failures (by area, most serious first: BROKEN, MISSING, HIDDEN, DOCS)

### Hotels
| Req | Kind | Operation | What fails | Why (cause) | Where |
|---|---|---|---|---|---|
| HTL-08 | BROKEN | GET /api/hotels/{id}/availability | A hotel moderator asking for room status over a date range gets 501 `INTERNAL_ERROR` instead of 200 with Available/Booked/Blocked per room. The C8 stub check fails on the same line. | `HotelModeratorService.availability` calls `HotelsService.getRoomNights`, which is still the INV-02 stub (`throw new NotImplementedException('getRoomNights: implemented in INV-02')`). The moderator API spec runs on `FakeHotelsService`, so CI never saw it. | hotels.service.ts:493 (called from hotel-moderator.service.ts:127) |
| HTL-17 | HIDDEN | GET /api/hotel-bookings/{id} | Confirmation after payment works (its probes pass), but no summary or description names HTL-17. | The summary names HTL-20 only. | hotel-bookings.controller.ts:111 |

### Flights and flight bookings
| Req | Kind | Operation | What fails | Why (cause) | Where |
|---|---|---|---|---|---|
| — | BROKEN | GET /api/flight-bookings/{id} | `abc` as id answers 404 `NOT_FOUND`, not 400 `VALIDATION_FAILED`. | `@Param('id') id: string` has no `ParseObjectIdPipe`, so a malformed id reaches the lookup and is reported as not found. | flight-bookings.controller.ts:141 |
| — | BROKEN | GET /api/flight-bookings/{id}/e-ticket | Same: 404 instead of 400. | Same cause. | flight-bookings.controller.ts:169 |
| — | BROKEN | GET /api/flight-bookings/{id}/refund-preview | Same: 404 instead of 400. | Same cause. | flight-bookings.controller.ts:199 |
| — | BROKEN | POST /api/flight-bookings/{id}/cancel | Same: 404 instead of 400. | Same cause. | flight-bookings.controller.ts:228 |
| — | BROKEN | GET /api/flights/{id}/bookings | Same: 404 instead of 400. | Same cause. | flight-moderator-bookings.controller.ts:50 |
| — | BROKEN | GET /api/flights/{id}/passengers/export | Same: 404 instead of 400. | Same cause. | flight-moderator-bookings.controller.ts:69 |
| FLT-30 | HIDDEN | GET /api/flights/{id}, GET /api/flights/search | Only Scheduled flights are searchable (probes pass), but no operation names FLT-30. | The summaries name FLT-17 and FLT-11/12/15 only. | flights.controller.ts:91, flights.controller.ts:62 |

### Accounts and cross-cutting
| Req | Kind | Operation | What fails | Why (cause) | Where |
|---|---|---|---|---|---|
| ACC-11 | HIDDEN | GET /api/flight-bookings/{id}, GET /api/hotel-bookings/{id}, GET /api/itineraries/{id} | Another user gets 404 (probes pass), but no Swagger text names ACC-11. | ACC-11 is written only in code comments (`/** … (ACC-11) */`), which Swagger does not show. | flight-bookings.controller.ts:129, hotel-bookings.controller.ts:111, itineraries.controller.ts:202 |
| ACC-18 | HIDDEN | POST /api/auth/login | The seeded admin logs in (probe passes), but nothing names ACC-18. | The login summary and description name ACC-04, ACC-05 and ACC-19 only. | auth.controller.ts:64 |
| GEN-02 | HIDDEN | POST /api/auth/register | Field-level validation messages work, but GEN-02 is not named. | The register summary names ACC-01 only. | auth.controller.ts:47 |
| GEN-13 | HIDDEN | POST /api/auth/register | Backend validation and hashed passwords work, but GEN-13 is not named. | Same summary. | auth.controller.ts:47 |
| GEN-11 | HIDDEN | GET /api/flight-bookings/{id}, GET /api/hotel-bookings/{id} | Lifecycle statuses show correctly, but GEN-11 is not named. | The summaries name FLT-25 / HTL-20 only. | flight-bookings.controller.ts:130, hotel-bookings.controller.ts:111 |

### Payments
| Req | Kind | Operation | What fails | Why (cause) | Where |
|---|---|---|---|---|---|
| PAY-04 | HIDDEN | POST /api/payments, POST /api/flight-bookings | Every amount uses the platform currency (probes pass), but PAY-04 is not named. | The summaries name PAY-01 and FLT-19/FLT-21 only. | payments.controller.ts:45, flight-bookings.controller.ts:70 |

### Itineraries
| Req | Kind | Operation | What fails | Why (cause) | Where |
|---|---|---|---|---|---|
| ITN-09 | HIDDEN | GET /api/itineraries/{id} | City groups with day count and subtotal are returned, but ITN-09 is not named. | The summary names ITN-03 only. | itineraries.controller.ts:202 |
| — | DOCS | GET /api/itineraries/{id}/flights | No 200 response schema, so Swagger UI shows no response model. | `@ApiOkResponse({ description: 'Flight search results' })` has no `type`. The handler also returns `id` instead of the contract's `_id`. | itineraries.controller.ts:243 |

## All requirements
| Req | Status | Operations | Probes (passed/total) |
|---|---|---|---|
| ACC-01 | ✅ | POST /api/auth/register | 4/4 |
| ACC-04 | ✅ | POST /api/auth/login<br>GET /api/auth/me | 3/3 |
| ACC-05 | ✅ | POST /api/auth/login | 1/1 |
| ACC-06 | ✅ | POST /api/auth/logout<br>POST /api/auth/refresh | 2/2 |
| ACC-07a | ✅ | POST /api/admin/users/{id}/reset-password<br>PATCH /api/auth/change-password | 3/3 |
| ACC-08 | ✅ | PATCH /api/auth/change-password | 1/1 |
| ACC-09 | ✅ | GET /api/users/me<br>PATCH /api/users/me | 3/3 |
| ACC-11 | ❌ | GET /api/flight-bookings/{id}<br>GET /api/hotel-bookings/{id}<br>GET /api/itineraries/{id} | 3/3 |
| ACC-12 | ✅ | DELETE /api/users/me | 3/3 |
| ACC-13 | ✅ | POST /api/admin/moderators | 1/1 |
| ACC-14 | ✅ | GET /api/admin/accounts | 1/1 |
| ACC-15 | ✅ | PATCH /api/admin/accounts/{id}/suspend<br>PATCH /api/admin/providers/{type}/{id}/deactivate<br>PATCH /api/admin/providers/{type}/{id}/reactivate | 3/3 |
| ACC-16 | ✅ | PATCH /api/admin/accounts/{id}/suspend<br>PATCH /api/admin/accounts/{id}/reactivate | 2/2 |
| ACC-17 | ✅ | GET /api/admin/bookings | 1/1 |
| ACC-18 | ❌ | POST /api/auth/login | 2/2 |
| ACC-19 | ✅ | POST /api/auth/login<br>GET /api/auth/me | 2/2 |
| FLT-01 | ✅ | POST /api/airlines<br>PATCH /api/airlines/{id}<br>GET /api/airlines/{id} | 3/3 |
| FLT-02 | ✅ | GET /api/airports | 1/1 |
| FLT-03 | ✅ | POST /api/flights | 5/5 |
| FLT-04 | ✅ | POST /api/flights/{id}/cabins<br>PATCH /api/flights/{id}/cabins/{cabinId} | 4/4 |
| FLT-05 | ✅ | PATCH /api/flights/{id}<br>PATCH /api/flights/{id}/cabins/{cabinId}<br>GET /api/airlines/{id}/flights | 3/3 |
| FLT-06 | ✅ | POST /api/flights/{id}/cancel | 1/1 |
| FLT-08 | ✅ | PUT /api/airlines/{id}/baggage-policy | 2/2 |
| FLT-09 | ✅ | PUT /api/airlines/{id}/cancellation-policy | 2/2 |
| FLT-11 | ✅ | GET /api/flights/search | 2/2 |
| FLT-12 | ✅ | GET /api/flights/search<br>POST /api/flight-bookings/hold | 5/5 |
| FLT-15 | ✅ | GET /api/flights/search | 3/3 |
| FLT-17 | ✅ | GET /api/flights/{id} | 1/1 |
| FLT-19 | ✅ | POST /api/flight-bookings | 2/2 |
| FLT-21 | ✅ | POST /api/flight-bookings | 1/1 |
| FLT-22 | ✅ | POST /api/flight-bookings/hold | 2/2 |
| FLT-23 | ✅ | GET /api/flight-bookings/{id}<br>GET /api/flight-bookings/{id}/e-ticket | 2/2 |
| FLT-25 | ✅ | GET /api/flight-bookings<br>GET /api/flight-bookings/{id} | 2/2 |
| FLT-26 | ✅ | GET /api/flight-bookings/{id}/refund-preview<br>POST /api/flight-bookings/{id}/cancel | 3/3 |
| FLT-29 | ✅ | GET /api/flights/{id}/bookings<br>GET /api/flights/{id}/passengers/export | 3/3 |
| FLT-30 | ❌ | GET /api/flights/{id}<br>GET /api/flights/search | 2/2 |
| HTL-01 | ✅ | POST /api/hotels<br>PATCH /api/hotels/{id}<br>POST /api/hotels/{id}/photos | 3/3 |
| HTL-02 | ✅ | GET /api/hotels/{id} | 1/1 |
| HTL-03 | ✅ | POST /api/hotels/{id}/rooms<br>GET /api/hotels/{id}/rooms | 4/4 |
| HTL-04 | ✅ | POST /api/hotels/{id}/rooms/{roomId}/availability | 2/2 |
| HTL-05 | ✅ | PATCH /api/hotels/{id}/rooms/{roomId}<br>PATCH /api/hotels/{id}/rooms/{roomId}/availability | 3/3 |
| HTL-06 | ✅ | PATCH /api/hotels/{id}/rooms/{roomId}/availability<br>PATCH /api/hotels/{id}/rooms/{roomId}<br>DELETE /api/hotels/{id}/rooms/{roomId} | 5/5 |
| HTL-08 | ❌ | GET /api/hotels/{id}/availability | 0/1 |
| HTL-09 | ✅ | PUT /api/hotels/{id}/policies | 1/1 |
| HTL-10 | ✅ | PUT /api/hotels/{id}/policies | 2/2 |
| HTL-11 | ✅ | GET /api/hotels/search | 3/3 |
| HTL-12 | ✅ | GET /api/hotels/search | 2/2 |
| HTL-15 | ✅ | GET /api/hotels/{id}/rooms/available | 1/1 |
| HTL-16 | ✅ | POST /api/hotel-bookings | 3/3 |
| HTL-17 | ❌ | GET /api/hotel-bookings/{id} | 1/1 |
| HTL-18 | ✅ | POST /api/hotel-bookings | 2/2 |
| HTL-20 | ✅ | GET /api/hotel-bookings<br>GET /api/hotel-bookings/{id} | 1/1 |
| HTL-21 | ✅ | GET /api/hotel-bookings/{id}/refund-preview<br>POST /api/hotel-bookings/{id}/cancel | 2/2 |
| HTL-22 | ✅ | GET /api/hotels/{id}/reservations | 1/1 |
| HTL-23 | ✅ | POST /api/hotel-bookings/{id}/review<br>PATCH /api/reviews/{id}<br>DELETE /api/reviews/{id} | 5/5 |
| HTL-24 | ✅ | GET /api/hotels/{id}/reviews | 1/1 |
| PAY-01 | ✅ | POST /api/payments<br>POST /api/payments/webhook<br>GET /api/payments/{id}<br>POST /api/payments/{id}/retry | 5/5 |
| PAY-02 | ✅ | GET /api/bookings/{type}/{id}/policies<br>POST /api/bookings/{type}/{id}/accept-policies | 3/3 |
| PAY-03 | ✅ | GET /api/refunds/{id}<br>POST /api/payments/webhook | 2/2 |
| PAY-04 | ❌ | POST /api/payments<br>POST /api/flight-bookings | 2/2 |
| ITN-01 | ✅ | POST /api/itineraries<br>PATCH /api/itineraries/{id}<br>DELETE /api/itineraries/{id} | 5/5 |
| ITN-03 | ✅ | GET /api/itineraries<br>GET /api/itineraries/{id} | 2/2 |
| ITN-05 | ✅ | POST /api/itineraries/{id}/days<br>PATCH /api/itineraries/{id}/days/{dayId} | 3/3 |
| ITN-07 | ✅ | DELETE /api/itineraries/{id}/days/{dayId} | 1/1 |
| ITN-08 | ✅ | PATCH /api/itineraries/{id}/days/reorder | 1/1 |
| ITN-09 | ❌ | GET /api/itineraries/{id} | 1/1 |
| ITN-10 | ✅ | POST /api/itineraries/{id}/days/{dayId}/activities<br>PATCH /api/activities/{id}<br>DELETE /api/activities/{id} | 3/3 |
| ITN-12 | ✅ | POST /api/activities/{id}/images<br>DELETE /api/activities/{id}/images/{imageId} | 2/2 |
| ITN-14 | ✅ | POST /api/itineraries/{id}/days/{dayId}/budgets<br>PATCH /api/budgets/{id}<br>GET /api/itineraries/{id}/budget-summary | 4/4 |
| ITN-16 | ✅ | POST /api/itineraries/{id}/transport-costs<br>PATCH /api/transport-costs/{id}<br>DELETE /api/transport-costs/{id} | 3/3 |
| ITN-18 | ✅ | GET /api/itineraries/{id}/budget-summary<br>GET /api/exchange-rates/latest | 2/2 |
| ITN-20 | ✅ | PATCH /api/itineraries/{id}<br>GET /api/itineraries/public/search | 3/3 |
| ITN-21 | ✅ | GET /api/itineraries/public/search<br>GET /api/itineraries/public/{id}<br>POST /api/itineraries/{id}/clone | 3/3 |
| ITN-25 | ✅ | GET /api/itineraries/{id}/hotels | 1/1 |
| ITN-26 | ✅ | GET /api/itineraries/{id}/flights | 1/1 |
| BLG-01 | ✅ | POST /api/posts | 2/2 |
| BLG-02 | ✅ | GET /api/posts<br>GET /api/posts/{id} | 2/2 |
| BLG-03 | ✅ | GET /api/posts/mine | 1/1 |
| BLG-04 | ✅ | PATCH /api/posts/{id}<br>DELETE /api/posts/{id} | 3/3 |
| BLG-05 | ✅ | POST /api/posts/{id}/comments<br>GET /api/posts/{id}/comments | 4/4 |
| BLG-06 | ✅ | POST /api/posts/{id}/like<br>DELETE /api/posts/{id}/like | 3/3 |
| BLG-07 | ✅ | PATCH /api/comments/{id}<br>DELETE /api/comments/{id} | 3/3 |
| BLG-08 | ✅ | GET /api/tags/{tag}/posts<br>PATCH /api/posts/{id} | 4/4 |
| BLG-09 | ✅ | GET /api/posts | 1/1 |
| BLG-10 | ✅ | POST /api/posts/{id}/images<br>DELETE /api/posts/{id}/images/{imageId} | 2/2 |
| BLG-12 | ✅ | GET /api/authors/{id} | 1/1 |
| GEN-01 | ✅ | GET /api/notifications<br>GET /api/notifications/unread-count<br>PATCH /api/notifications/{id}/read | 3/3 |
| GEN-02 | ❌ | POST /api/auth/register | 1/1 |
| GEN-05 | ✅ | GET /api/posts<br>GET /api/admin/accounts<br>GET /api/posts/{id}/comments | 2/2 |
| GEN-06 | ✅ | GET /api/flights/{id}<br>GET /api/flights/search<br>GET /api/flight-bookings/{id}/e-ticket | 1/1 |
| GEN-07 | ✅ | GET /api/admin/audit-logs | 1/1 |
| GEN-08 | ✅ | POST /api/posts/{id}/images<br>POST /api/hotels/{id}/photos<br>POST /api/airlines/{id}/logo | 3/3 |
| GEN-09 | ✅ | POST /api/reports | 2/2 |
| GEN-10 | ✅ | GET /api/admin/reports<br>PATCH /api/admin/reports/{id}<br>PATCH /api/admin/content/{type}/{id}/hide | 3/3 |
| GEN-11 | ❌ | GET /api/flight-bookings/{id}<br>GET /api/hotel-bookings/{id} | 2/2 |
| GEN-12 | ✅ | GET /api/countries<br>GET /api/cities<br>GET /api/currencies | 3/3 |
| GEN-13 | ❌ | POST /api/auth/register | 2/2 |

Guard probes over every operation: 315, of which 309 passed. The 6 failures are the G-id rows above.

## Frontend-only (not API-testable)
| Req | Note (§15.9) |
|---|---|
| ACC-10 | Frontend: send guests to login and back (the backend returns 401; G-auth proves the 401) |
| GEN-03 | Frontend: confirmation dialogs |
| GEN-04 | Frontend: empty states |
| GEN-14 | Frontend: information architecture |
| GEN-15 | Frontend: usability |
| GEN-16 | Frontend: feedback and responsiveness |
| GEN-17 | Frontend: visual consistency |

## Routes outside endpoints.md (extras)
- GET /api/itineraries/{id}/pdf: ITN-28, a bonus route (listed in endpoints.md as `(B)`).
- Ignored by design: /api/health and /api/docs*.

## Doc conflicts
- **ACC-11 vs endpoints.md:** ACC-11 says admins may view all bookings (through ACC-17), while endpoints.md marks GET /api/flight-bookings/{id} as Own. Today the admin gets 404 on the details route and sees bookings only through GET /api/admin/bookings. Not resolved here.
- **FLT-02 wording vs data model:** the requirement lists an "IATA code"; `docs/database/data-model.md` stores it as the airport `_id` (`'CAI'`). The API follows the data model, so graders see the code under `_id`.
- **HTL-08 label:** endpoints.md notes that the course PDF labels PUT /api/hotels/{id}/policies "HTL-08", while the workbook's HTL-08 is room status (GET /api/hotels/{id}/availability). The audit follows the workbook.
- The workbook CSV of mandatory requirements and `references/requirements.md` list the same 104 `[M]` IDs.

## Audit corrections (probes I fixed)
1. FLT-02: the probe required an `iataCode` key. The data model stores the IATA code as `_id`, so the probe now checks that `_id` is a 3-letter code.
2. Catalog: GEN-05 also lists GET /api/posts/{id}/comments, and GEN-06 also lists GET /api/flight-bookings/{id}/e-ticket, the operations whose Swagger text names them.
3. ITN-10 activity body: `cost: { amountMinor, currency }`, not `costMinor`/`currency`.
4. ACC-14 account search: the query is `q`, not `search`.
5. FLT-02 airports: `limit=50` (the DTO maximum), not 100.
6. FLT-15 price filter: `minPriceMinor`/`maxPriceMinor`.
7. ITN-26: the query is `origin`, not `from`.
8. FLT-19/21 extra-bag quote: sends `extraBagWeightKg`, which is required when `extraBagCount > 0`.
9. ACC-01: the check matched any "password" substring (including `mustChangePassword`); it now looks only for `password`/`passwordHash` keys.
10. G-auth on POST /api/auth/refresh: treated as cookie-protected; a 401 with `SESSION_EXPIRED` is accepted.
11. Removed an ACC-11 probe that expected admin access to GET /api/flight-bookings/{id}; see Doc conflicts.

## Fixes and decisions (after the audit)
The findings above describe develop 233f86d. Each cluster was fixed on its own local branch from `origin/develop` (not pushed):
| Fix | Branch | Covers |
|---|---|---|
| FIX-01 | `fix/TST-02-swagger-req-ids` | The 9 HIDDEN IDs named in summaries and descriptions; GET /api/itineraries/{id}/flights gets a documented 200 schema |
| FIX-02 | `fix/HTL-08-room-nights` | The real `HotelsService.getRoomNights` (HTL-08 501 and the C8 stub) |
| FIX-03 | `fix/TST-02-malformed-booking-ids` | `IsObjectIdPipe` on the 6 unvalidated `:id` params |

Decisions taken while fixing:
- **Malformed ids answer 400, not 404.** `backend.md:78` and every other `:id` route answer 400 `VALIDATION_FAILED`, and a 400 reveals nothing about other users' bookings. The 4 existing specs that expected 404 for `abc` now expect 400; unknown and other-user ids still answer 404 (ACC-11).
- **GET /api/itineraries/{id}/flights returns `_id`, not `id`** (approved by Kareem), so it matches GET /api/flights/search and the id contract.
- **`hotels.contract.spec.ts` is deleted.** Its only test pinned the INV-02 stub, which no longer exists. A new API spec covers HTL-08 on the real hotels service, which the fake-based moderator spec could not.

Re-run on the merged branch `test/TST-02-swagger-audit-and-fixes`: coverage 732 checks, 0 failed; smoke 539 probes, 0 failed; all 97 API-testable requirements pass. `npm run verify` passes (211 files / 3,455 tests, 48 e2e tests).
