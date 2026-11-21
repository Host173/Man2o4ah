/**
 * TST-02: every mandatory requirement of the course workbook and the Swagger
 * operation(s) a grader opens to test it, plus every non-bonus route of
 * `endpoints.md`. Built from requirements.md, the chat skill §15.9, endpoints.md,
 * modules.md and the controllers. Bonus (`[B]`) requirements are out of scope.
 */

export type AuditKind = 'api' | 'frontend-only';

export interface CatalogOperation {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** OpenAPI path, e.g. '/api/flights/{id}' */
  path: string;
}

export interface CatalogEntry {
  id: string;
  kind: AuditKind;
  /** Why it is frontend-only, from §15.9's note. Only for 'frontend-only'. */
  note?: string;
  /** The operation(s) a grader opens in Swagger to test this requirement. At least one for 'api'. */
  operations: CatalogOperation[];
  /** The module that serves the main operation (modules.md). */
  module: string;
}

type Method = CatalogOperation['method'];
const op = (method: Method, path: string): CatalogOperation => ({
  method,
  path,
});
const api = (
  id: string,
  module: string,
  ...operations: CatalogOperation[]
): CatalogEntry => ({ id, kind: 'api', module, operations });
const fe = (id: string, note: string): CatalogEntry => ({
  id,
  kind: 'frontend-only',
  note,
  operations: [],
  module: 'frontend',
});

export const CATALOG: CatalogEntry[] = [
  // Accounts & Admin
  api('ACC-01', 'accounts', op('POST', '/api/auth/register')),
  api('ACC-04', 'accounts', op('POST', '/api/auth/login'), op('GET', '/api/auth/me')),
  api('ACC-05', 'accounts', op('POST', '/api/auth/login')),
  api('ACC-06', 'accounts', op('POST', '/api/auth/logout'), op('POST', '/api/auth/refresh')),
  api(
    'ACC-07a',
    'admin',
    op('POST', '/api/admin/users/{id}/reset-password'),
    op('PATCH', '/api/auth/change-password'),
  ),
  api('ACC-08', 'accounts', op('PATCH', '/api/auth/change-password')),
  api('ACC-09', 'accounts', op('GET', '/api/users/me'), op('PATCH', '/api/users/me')),
  fe('ACC-10', 'Frontend: send guests to login and back (backend returns 401)'),
  api(
    'ACC-11',
    'flight-bookings',
    op('GET', '/api/flight-bookings/{id}'),
    op('GET', '/api/hotel-bookings/{id}'),
    op('GET', '/api/itineraries/{id}'),
  ),
  api('ACC-12', 'accounts', op('DELETE', '/api/users/me')),
  api('ACC-13', 'admin', op('POST', '/api/admin/moderators')),
  api('ACC-14', 'admin', op('GET', '/api/admin/accounts')),
  api(
    'ACC-15',
    'admin',
    op('PATCH', '/api/admin/accounts/{id}/suspend'),
    op('PATCH', '/api/admin/providers/{type}/{id}/deactivate'),
    op('PATCH', '/api/admin/providers/{type}/{id}/reactivate'),
  ),
  api(
    'ACC-16',
    'admin',
    op('PATCH', '/api/admin/accounts/{id}/suspend'),
    op('PATCH', '/api/admin/accounts/{id}/reactivate'),
  ),
  api('ACC-17', 'admin', op('GET', '/api/admin/bookings')),
  api('ACC-18', 'accounts', op('POST', '/api/auth/login')),
  api('ACC-19', 'accounts', op('POST', '/api/auth/login'), op('GET', '/api/auth/me')),

  // Flights
  api(
    'FLT-01',
    'flights',
    op('POST', '/api/airlines'),
    op('PATCH', '/api/airlines/{id}'),
    op('GET', '/api/airlines/{id}'),
  ),
  api('FLT-02', 'reference-data', op('GET', '/api/airports')),
  api('FLT-03', 'flights', op('POST', '/api/flights')),
  api(
    'FLT-04',
    'flights',
    op('POST', '/api/flights/{id}/cabins'),
    op('PATCH', '/api/flights/{id}/cabins/{cabinId}'),
  ),
  api(
    'FLT-05',
    'flights',
    op('PATCH', '/api/flights/{id}'),
    op('PATCH', '/api/flights/{id}/cabins/{cabinId}'),
    op('GET', '/api/airlines/{id}/flights'),
  ),
  api('FLT-06', 'flights', op('POST', '/api/flights/{id}/cancel')),
  api('FLT-08', 'flights', op('PUT', '/api/airlines/{id}/baggage-policy')),
  api('FLT-09', 'flights', op('PUT', '/api/airlines/{id}/cancellation-policy')),
  api('FLT-11', 'flights', op('GET', '/api/flights/search')),
  api(
    'FLT-12',
    'flights',
    op('GET', '/api/flights/search'),
    op('POST', '/api/flight-bookings/hold'),
  ),
  api('FLT-15', 'flights', op('GET', '/api/flights/search')),
  api('FLT-17', 'flights', op('GET', '/api/flights/{id}')),
  api('FLT-19', 'flight-bookings', op('POST', '/api/flight-bookings')),
  api('FLT-21', 'flight-bookings', op('POST', '/api/flight-bookings')),
  api('FLT-22', 'flight-bookings', op('POST', '/api/flight-bookings/hold')),
  api(
    'FLT-23',
    'flight-bookings',
    op('GET', '/api/flight-bookings/{id}'),
    op('GET', '/api/flight-bookings/{id}/e-ticket'),
  ),
  api(
    'FLT-25',
    'flight-bookings',
    op('GET', '/api/flight-bookings'),
    op('GET', '/api/flight-bookings/{id}'),
  ),
  api(
    'FLT-26',
    'flight-bookings',
    op('GET', '/api/flight-bookings/{id}/refund-preview'),
    op('POST', '/api/flight-bookings/{id}/cancel'),
  ),
  api(
    'FLT-29',
    'flight-bookings',
    op('GET', '/api/flights/{id}/bookings'),
    op('GET', '/api/flights/{id}/passengers/export'),
  ),
  api('FLT-30', 'flights', op('GET', '/api/flights/{id}'), op('GET', '/api/flights/search')),

  // Hotels
  api(
    'HTL-01',
    'hotels',
    op('POST', '/api/hotels'),
    op('PATCH', '/api/hotels/{id}'),
    op('POST', '/api/hotels/{id}/photos'),
  ),
  api('HTL-02', 'hotels', op('GET', '/api/hotels/{id}')),
  api(
    'HTL-03',
    'hotels',
    op('POST', '/api/hotels/{id}/rooms'),
    op('GET', '/api/hotels/{id}/rooms'),
  ),
  api('HTL-04', 'hotels', op('POST', '/api/hotels/{id}/rooms/{roomId}/availability')),
  api(
    'HTL-05',
    'hotels',
    op('PATCH', '/api/hotels/{id}/rooms/{roomId}'),
    op('PATCH', '/api/hotels/{id}/rooms/{roomId}/availability'),
  ),
  api(
    'HTL-06',
    'hotels',
    op('PATCH', '/api/hotels/{id}/rooms/{roomId}/availability'),
    op('PATCH', '/api/hotels/{id}/rooms/{roomId}'),
    op('DELETE', '/api/hotels/{id}/rooms/{roomId}'),
  ),
  api('HTL-08', 'hotel-bookings', op('GET', '/api/hotels/{id}/availability')),
  api('HTL-09', 'hotels', op('PUT', '/api/hotels/{id}/policies')),
  api('HTL-10', 'hotels', op('PUT', '/api/hotels/{id}/policies')),
  api('HTL-11', 'hotels', op('GET', '/api/hotels/search')),
  api('HTL-12', 'hotels', op('GET', '/api/hotels/search')),
  api('HTL-15', 'hotels', op('GET', '/api/hotels/{id}/rooms/available')),
  api('HTL-16', 'hotel-bookings', op('POST', '/api/hotel-bookings')),
  api('HTL-17', 'hotel-bookings', op('GET', '/api/hotel-bookings/{id}')),
  api('HTL-18', 'hotel-bookings', op('POST', '/api/hotel-bookings')),
  api(
    'HTL-20',
    'hotel-bookings',
    op('GET', '/api/hotel-bookings'),
    op('GET', '/api/hotel-bookings/{id}'),
  ),
  api(
    'HTL-21',
    'hotel-bookings',
    op('GET', '/api/hotel-bookings/{id}/refund-preview'),
    op('POST', '/api/hotel-bookings/{id}/cancel'),
  ),
  api('HTL-22', 'hotel-bookings', op('GET', '/api/hotels/{id}/reservations')),
  api(
    'HTL-23',
    'hotel-bookings',
    op('POST', '/api/hotel-bookings/{id}/review'),
    op('PATCH', '/api/reviews/{id}'),
    op('DELETE', '/api/reviews/{id}'),
  ),
  api('HTL-24', 'hotel-bookings', op('GET', '/api/hotels/{id}/reviews')),

  // Payments & Policies
  api(
    'PAY-01',
    'payments',
    op('POST', '/api/payments'),
    op('POST', '/api/payments/webhook'),
    op('GET', '/api/payments/{id}'),
    op('POST', '/api/payments/{id}/retry'),
  ),
  api(
    'PAY-02',
    'payments',
    op('GET', '/api/bookings/{type}/{id}/policies'),
    op('POST', '/api/bookings/{type}/{id}/accept-policies'),
  ),
  api(
    'PAY-03',
    'payments',
    op('GET', '/api/refunds/{id}'),
    op('POST', '/api/payments/webhook'),
  ),
  api(
    'PAY-04',
    'payments',
    op('POST', '/api/payments'),
    op('POST', '/api/flight-bookings'),
  ),

  // Itineraries
  api(
    'ITN-01',
    'itineraries',
    op('POST', '/api/itineraries'),
    op('PATCH', '/api/itineraries/{id}'),
    op('DELETE', '/api/itineraries/{id}'),
  ),
  api(
    'ITN-03',
    'itineraries',
    op('GET', '/api/itineraries'),
    op('GET', '/api/itineraries/{id}'),
  ),
  api(
    'ITN-05',
    'itineraries',
    op('POST', '/api/itineraries/{id}/days'),
    op('PATCH', '/api/itineraries/{id}/days/{dayId}'),
  ),
  api('ITN-07', 'itineraries', op('DELETE', '/api/itineraries/{id}/days/{dayId}')),
  api('ITN-08', 'itineraries', op('PATCH', '/api/itineraries/{id}/days/reorder')),
  api('ITN-09', 'itineraries', op('GET', '/api/itineraries/{id}')),
  api(
    'ITN-10',
    'itineraries',
    op('POST', '/api/itineraries/{id}/days/{dayId}/activities'),
    op('PATCH', '/api/activities/{id}'),
    op('DELETE', '/api/activities/{id}'),
  ),
  api(
    'ITN-12',
    'itineraries',
    op('POST', '/api/activities/{id}/images'),
    op('DELETE', '/api/activities/{id}/images/{imageId}'),
  ),
  api(
    'ITN-14',
    'itineraries',
    op('POST', '/api/itineraries/{id}/days/{dayId}/budgets'),
    op('PATCH', '/api/budgets/{id}'),
    op('GET', '/api/itineraries/{id}/budget-summary'),
  ),
  api(
    'ITN-16',
    'itineraries',
    op('POST', '/api/itineraries/{id}/transport-costs'),
    op('PATCH', '/api/transport-costs/{id}'),
    op('DELETE', '/api/transport-costs/{id}'),
  ),
  api(
    'ITN-18',
    'itineraries',
    op('GET', '/api/itineraries/{id}/budget-summary'),
    op('GET', '/api/exchange-rates/latest'),
  ),
  api(
    'ITN-20',
    'itineraries',
    op('PATCH', '/api/itineraries/{id}'),
    op('GET', '/api/itineraries/public/search'),
  ),
  api(
    'ITN-21',
    'itineraries',
    op('GET', '/api/itineraries/public/search'),
    op('GET', '/api/itineraries/public/{id}'),
    op('POST', '/api/itineraries/{id}/clone'),
  ),
  api('ITN-25', 'itineraries', op('GET', '/api/itineraries/{id}/hotels')),
  api('ITN-26', 'itineraries', op('GET', '/api/itineraries/{id}/flights')),

  // Blog
  api('BLG-01', 'blog', op('POST', '/api/posts')),
  api('BLG-02', 'blog', op('GET', '/api/posts'), op('GET', '/api/posts/{id}')),
  api('BLG-03', 'blog', op('GET', '/api/posts/mine')),
  api('BLG-04', 'blog', op('PATCH', '/api/posts/{id}'), op('DELETE', '/api/posts/{id}')),
  api(
    'BLG-05',
    'blog',
    op('POST', '/api/posts/{id}/comments'),
    op('GET', '/api/posts/{id}/comments'),
  ),
  api(
    'BLG-06',
    'blog',
    op('POST', '/api/posts/{id}/like'),
    op('DELETE', '/api/posts/{id}/like'),
  ),
  api(
    'BLG-07',
    'blog',
    op('PATCH', '/api/comments/{id}'),
    op('DELETE', '/api/comments/{id}'),
  ),
  api('BLG-08', 'blog', op('GET', '/api/tags/{tag}/posts'), op('PATCH', '/api/posts/{id}')),
  api('BLG-09', 'blog', op('GET', '/api/posts')),
  api(
    'BLG-10',
    'blog',
    op('POST', '/api/posts/{id}/images'),
    op('DELETE', '/api/posts/{id}/images/{imageId}'),
  ),
  api('BLG-12', 'blog', op('GET', '/api/authors/{id}')),

  // Cross-cutting
  api(
    'GEN-01',
    'notifications',
    op('GET', '/api/notifications'),
    op('GET', '/api/notifications/unread-count'),
    op('PATCH', '/api/notifications/{id}/read'),
  ),
  api('GEN-02', 'common', op('POST', '/api/auth/register')),
  fe('GEN-03', 'Frontend: confirmation dialogs'),
  fe('GEN-04', 'Frontend: empty states'),
  api('GEN-05', 'common', op('GET', '/api/posts'), op('GET', '/api/admin/accounts')),
  api('GEN-06', 'flights', op('GET', '/api/flights/{id}'), op('GET', '/api/flights/search')),
  api('GEN-07', 'admin', op('GET', '/api/admin/audit-logs')),
  api(
    'GEN-08',
    'storage',
    op('POST', '/api/posts/{id}/images'),
    op('POST', '/api/hotels/{id}/photos'),
    op('POST', '/api/airlines/{id}/logo'),
  ),
  api('GEN-09', 'moderation', op('POST', '/api/reports')),
  api(
    'GEN-10',
    'admin',
    op('GET', '/api/admin/reports'),
    op('PATCH', '/api/admin/reports/{id}'),
    op('PATCH', '/api/admin/content/{type}/{id}/hide'),
  ),
  api(
    'GEN-11',
    'flight-bookings',
    op('GET', '/api/flight-bookings/{id}'),
    op('GET', '/api/hotel-bookings/{id}'),
  ),
  api(
    'GEN-12',
    'reference-data',
    op('GET', '/api/countries'),
    op('GET', '/api/cities'),
    op('GET', '/api/currencies'),
  ),
  api('GEN-13', 'common', op('POST', '/api/auth/register')),
  fe('GEN-14', 'Frontend: information architecture'),
  fe('GEN-15', 'Frontend: usability'),
  fe('GEN-16', 'Frontend: feedback and responsiveness'),
  fe('GEN-17', 'Frontend: visual consistency'),
];

const e = op;

/** Every non-bonus row of endpoints.md, in OpenAPI form. */
export const ENDPOINTS: CatalogOperation[] = [
  // Auth & accounts
  e('POST', '/api/auth/register'),
  e('POST', '/api/auth/login'),
  e('POST', '/api/auth/refresh'),
  e('POST', '/api/auth/logout'),
  e('GET', '/api/auth/me'),
  e('PATCH', '/api/auth/change-password'),
  e('GET', '/api/users/me'),
  e('PATCH', '/api/users/me'),
  e('DELETE', '/api/users/me'),
  // Admin
  e('POST', '/api/admin/moderators'),
  e('GET', '/api/admin/accounts'),
  e('PATCH', '/api/admin/accounts/{id}/suspend'),
  e('PATCH', '/api/admin/accounts/{id}/reactivate'),
  e('POST', '/api/admin/users/{id}/reset-password'),
  e('PATCH', '/api/admin/providers/{type}/{id}/deactivate'),
  e('PATCH', '/api/admin/providers/{type}/{id}/reactivate'),
  e('GET', '/api/admin/bookings'),
  e('GET', '/api/admin/reports'),
  e('PATCH', '/api/admin/reports/{id}'),
  e('DELETE', '/api/admin/content/{type}/{id}'),
  e('PATCH', '/api/admin/content/{type}/{id}/hide'),
  e('GET', '/api/admin/audit-logs'),
  // Reference & supporting
  e('GET', '/api/countries'),
  e('GET', '/api/cities'),
  e('GET', '/api/currencies'),
  e('GET', '/api/attractions'),
  e('GET', '/api/exchange-rates/latest'),
  e('POST', '/api/reports'),
  e('GET', '/api/notifications'),
  e('GET', '/api/notifications/unread-count'),
  e('PATCH', '/api/notifications/{id}/read'),
  e('PATCH', '/api/notifications/read-all'),
  // Airlines & flights
  e('POST', '/api/airlines'),
  e('GET', '/api/airlines/{id}'),
  e('PATCH', '/api/airlines/{id}'),
  e('POST', '/api/airlines/{id}/logo'),
  e('PUT', '/api/airlines/{id}/baggage-policy'),
  e('PUT', '/api/airlines/{id}/cancellation-policy'),
  e('GET', '/api/airlines/{id}/flights'),
  e('GET', '/api/airports'),
  e('POST', '/api/flights'),
  e('GET', '/api/flights/search'),
  e('GET', '/api/flights/{id}'),
  e('PATCH', '/api/flights/{id}'),
  e('POST', '/api/flights/{id}/cancel'),
  e('POST', '/api/flights/{id}/cabins'),
  e('PATCH', '/api/flights/{id}/cabins/{cabinId}'),
  e('GET', '/api/flights/{id}/bookings'),
  e('GET', '/api/flights/{id}/passengers/export'),
  // Flight bookings
  e('POST', '/api/flight-bookings'),
  e('POST', '/api/flight-bookings/hold'),
  e('GET', '/api/flight-bookings'),
  e('GET', '/api/flight-bookings/{id}'),
  e('GET', '/api/flight-bookings/{id}/refund-preview'),
  e('POST', '/api/flight-bookings/{id}/cancel'),
  e('GET', '/api/flight-bookings/{id}/e-ticket'),
  // Hotels & rooms
  e('POST', '/api/hotels'),
  e('GET', '/api/hotels/search'),
  e('GET', '/api/hotels/{id}'),
  e('PATCH', '/api/hotels/{id}'),
  e('POST', '/api/hotels/{id}/photos'),
  e('DELETE', '/api/hotels/{id}/photos/{photoId}'),
  e('PUT', '/api/hotels/{id}/policies'),
  e('GET', '/api/hotels/{id}/rooms'),
  e('POST', '/api/hotels/{id}/rooms'),
  e('PATCH', '/api/hotels/{id}/rooms/{roomId}'),
  e('DELETE', '/api/hotels/{id}/rooms/{roomId}'),
  e('GET', '/api/hotels/{id}/rooms/available'),
  e('POST', '/api/hotels/{id}/rooms/{roomId}/availability'),
  e('PATCH', '/api/hotels/{id}/rooms/{roomId}/availability'),
  e('GET', '/api/hotels/{id}/availability'),
  e('GET', '/api/hotels/{id}/reservations'),
  // Hotel bookings & reviews
  e('POST', '/api/hotel-bookings'),
  e('GET', '/api/hotel-bookings'),
  e('GET', '/api/hotel-bookings/{id}'),
  e('GET', '/api/hotel-bookings/{id}/refund-preview'),
  e('POST', '/api/hotel-bookings/{id}/cancel'),
  e('POST', '/api/hotel-bookings/{id}/review'),
  e('PATCH', '/api/reviews/{id}'),
  e('DELETE', '/api/reviews/{id}'),
  e('GET', '/api/hotels/{id}/reviews'),
  // Payments & refunds
  e('GET', '/api/bookings/{type}/{id}/policies'),
  e('POST', '/api/bookings/{type}/{id}/accept-policies'),
  e('POST', '/api/payments'),
  e('POST', '/api/payments/{id}/retry'),
  e('GET', '/api/payments/{id}'),
  e('POST', '/api/payments/webhook'),
  e('GET', '/api/refunds/{id}'),
  // Itineraries
  e('POST', '/api/itineraries'),
  e('GET', '/api/itineraries'),
  e('GET', '/api/itineraries/{id}'),
  e('PATCH', '/api/itineraries/{id}'),
  e('DELETE', '/api/itineraries/{id}'),
  e('POST', '/api/itineraries/{id}/days'),
  e('PATCH', '/api/itineraries/{id}/days/{dayId}'),
  e('DELETE', '/api/itineraries/{id}/days/{dayId}'),
  e('PATCH', '/api/itineraries/{id}/days/reorder'),
  e('POST', '/api/itineraries/{id}/days/{dayId}/activities'),
  e('PATCH', '/api/activities/{id}'),
  e('DELETE', '/api/activities/{id}'),
  e('POST', '/api/activities/{id}/images'),
  e('DELETE', '/api/activities/{id}/images/{imageId}'),
  e('POST', '/api/itineraries/{id}/days/{dayId}/budgets'),
  e('PATCH', '/api/budgets/{id}'),
  e('DELETE', '/api/budgets/{id}'),
  e('POST', '/api/itineraries/{id}/transport-costs'),
  e('PATCH', '/api/transport-costs/{id}'),
  e('DELETE', '/api/transport-costs/{id}'),
  e('GET', '/api/itineraries/{id}/budget-summary'),
  e('GET', '/api/itineraries/public/search'),
  e('GET', '/api/itineraries/public/{id}'),
  e('POST', '/api/itineraries/{id}/clone'),
  e('GET', '/api/itineraries/{id}/hotels'),
  e('GET', '/api/itineraries/{id}/flights'),
  // Blog
  e('POST', '/api/posts'),
  e('GET', '/api/posts'),
  e('GET', '/api/posts/mine'),
  e('GET', '/api/posts/{id}'),
  e('PATCH', '/api/posts/{id}'),
  e('DELETE', '/api/posts/{id}'),
  e('GET', '/api/posts/{id}/comments'),
  e('POST', '/api/posts/{id}/comments'),
  e('PATCH', '/api/comments/{id}'),
  e('DELETE', '/api/comments/{id}'),
  e('POST', '/api/posts/{id}/like'),
  e('DELETE', '/api/posts/{id}/like'),
  e('POST', '/api/posts/{id}/images'),
  e('DELETE', '/api/posts/{id}/images/{imageId}'),
  e('GET', '/api/tags/{tag}/posts'),
  e('GET', '/api/authors/{id}'),
];
