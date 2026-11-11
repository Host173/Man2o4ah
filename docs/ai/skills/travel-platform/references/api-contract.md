# API contract: how frontend and backend connect

This is the shared layer (decisions: `docs/DECISIONS.md` §17). Changing anything here needs the team leader's approval. The rewrite, the global error filter and the error-code enum are built by the Platform package.

## Contents
1. Topology (rewrites) · 2. Environment variables · 3. Response shapes and error codes · 4. Types from OpenAPI · 5. Frontend fetch helpers · 6. Uploaded images

## 1. Topology

```
Browser ──► Next.js :3000 ──(rewrite /api/*, /uploads/*)──► NestJS :4000 ──► MongoDB Atlas
                  │                                         ├─► Stripe API (secret key)
                  └─(server-side fetch, forwards cookies)──►├─► FXRatesAPI
Stripe ──webhook──► NestJS /api/payments/webhook            
```
- The browser only ever talks to `:3000`. Next rewrites `/api/:path*` and `/uploads/:path*` to the backend, so cookies are first-party and no CORS preflight happens. CORS is still enabled on Nest for direct tools.
- Server Components and Server Actions call the backend directly at `BACKEND_URL` and forward the incoming `cookie` header.

```ts
// frontend/next.config.ts
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${process.env.BACKEND_URL}/api/:path*` },
      { source: '/uploads/:path*', destination: `${process.env.BACKEND_URL}/uploads/:path*` },
    ];
  },
};
```

## 2. Environment variables

`backend/.env`
```
PORT=4000
MONGODB_URI=                     # team leader shares it privately (never in git)
FRONTEND_URL=http://localhost:3000
JWT_ACCESS_SECRET=               # openssl rand -base64 32
JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=7
SESSION_IDLE_MINUTES=30
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...  # printed by `stripe listen`
PLATFORM_CURRENCY=USD
FXRATES_API_KEY=                 # optional; the API works without it at low volume
UPLOAD_DIR=uploads
SEED_ADMIN_EMAIL=  SEED_ADMIN_PASSWORD=
```
`frontend/.env.local`
```
BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```
Only `NEXT_PUBLIC_*` reaches the browser. Never prefix a secret with it.
Each variable is added to `.env.example` by the ticket that first needs it (today's `.env.example` only has what exists). `BACKEND_URL` replaces the scaffold's `NEXT_PUBLIC_API_URL` when the rewrite is added.

## 3. Response shapes

**Success:** the resource JSON itself (no `{ data: … }` wrapper). IDs keep Mongo's field name `_id` (a 24-hex string in JSON; reference data uses its dataset id, such as `"CAI"`). Don't rename to `id`; `.lean()` results then need no mapping. Instants are ISO-8601 UTC strings (`2026-12-01T12:30:00.000Z`). Calendar dates (`DateOnly` in the database) travel as `YYYY-MM-DD` strings in requests and responses, converted with `common/dates`. Money keeps the data model's names and minor units: `{ totalMinor: 12550, currency: 'USD' }`, `priceMinor`, `amountMinor`; the frontend formats it (`lib/format.ts`). Enum values are the data model's lowercase values (`pending_payment`).

**List:**
```json
{ "items": [], "page": 1, "limit": 10, "total": 42, "totalPages": 5 }
```
Query params: `page`, `limit`, `sortBy`, `sortOrder=asc|desc`, plus filters named after fields (`minPrice`, `maxPrice`, `status`, `role`, `q` for keyword).

**Error** (every non-2xx response, produced by `AllExceptionsFilter`):
```json
{
  "statusCode": 409,
  "code": "SEATS_UNAVAILABLE",
  "message": "Not enough seats left in Economy",
  "details": [{ "field": "passengers", "message": "..." }],
  "path": "/api/flight-bookings/hold",
  "timestamp": "2026-11-20T10:00:00.000Z"
}
```
`details` is present for validation errors (400 `VALIDATION_FAILED`), one entry per field. The frontend shows `details` next to form fields (GEN-02) and `message` in a toast or alert.

Codes live in **one enum**, `backend/src/common/errors/error-codes.ts`: PascalCase keys in code (`ErrorCode.SeatsUnavailable`), UPPER_SNAKE values on the wire (`"SEATS_UNAVAILABLE"`). The data model's "Fails with" columns name the keys. Starting set: `VALIDATION_FAILED`, `NOT_AUTHENTICATED`, `TOKEN_EXPIRED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `ACCOUNT_SUSPENDED`, `PASSWORD_CHANGE_REQUIRED`, `FORBIDDEN_ROLE`, `NOT_FOUND`, `EMAIL_TAKEN`, `SEATS_UNAVAILABLE`, `ROOMS_UNAVAILABLE`, `CAPACITY_BELOW_RESERVED`, `CONCURRENT_CHANGE`, `AVAILABILITY_HAS_RESERVATIONS`, `ROOM_HAS_RESERVATIONS`, `ROOM_WAS_RESERVED`, `OVERLAPS_RESERVATION_OR_BLOCK`, `HOLD_EXPIRED`, `INVALID_STATUS_TRANSITION`, `POLICIES_NOT_ACCEPTED`, `BAD_SIGNATURE`, `UNSUPPORTED_CURRENCY`, `RATES_UNAVAILABLE`, `ALREADY_REPORTED`, `ALREADY_REVIEWED`, `ACTIVE_BOOKINGS_EXIST`, `LIMIT_EXCEEDED`, `INVENTORY_CORRUPTED` (500; an inventory invariant broke, should never happen). A new code is added to the enum (and this list) in the same PR that first uses it. Tests assert the status and the code, never the message.

## 4. Types

The OpenAPI spec is the contract. The frontend generates its types from it; nobody hand-writes duplicate interfaces.
```bash
# frontend/package.json script "api:types" (backend must be running)
npx openapi-typescript http://localhost:4000/api/docs-json -o src/lib/api/schema.d.ts
```
Use them as `components['schemas']['FlightResponseDto']`. Re-run after any backend DTO change and commit the regenerated file in the same PR.

## 5. Frontend fetch helpers (the only two ways to call the backend)

`src/lib/api/server.ts` (Server Components, Server Actions, route handlers):
```ts
import 'server-only';
import { cookies } from 'next/headers';
export async function serverFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookie = (await cookies()).toString();
  const res = await fetch(`${process.env.BACKEND_URL}/api${path}`, {
    ...init, cache: init.cache ?? 'no-store',
    headers: { 'content-type': 'application/json', cookie, ...init.headers },
  });
  if (!res.ok) throw await ApiError.from(res);   // see src/lib/api/errors.ts
  return res.status === 204 ? (undefined as T) : res.json();
}
```
For public ISR pages, pass `{ cache: 'force-cache', next: { revalidate: 60, tags: ['post:<id>'] } }` and don't read cookies.

`src/lib/api/client.ts` (Client Components):
```ts
export async function apiFetch<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers } });
  if (res.status === 401 && !retried) {
    const body = await res.clone().json().catch(() => null);
    if (body?.code === 'TOKEN_EXPIRED' && (await fetch('/api/auth/refresh', { method: 'POST' })).ok)
      return apiFetch<T>(path, init, true);
  }
  if (!res.ok) throw await ApiError.from(res);
  return res.status === 204 ? (undefined as T) : res.json();
}
```
For multipart uploads, pass a `FormData` body and **delete** the `content-type` header so the browser sets the boundary.

`ApiError` holds `statusCode, code, message, details`. In Server Components: 401 means `redirect('/login?next=…')`, 404 means `notFound()`, anything else bubbles to `error.tsx`.

## 6. Uploaded images

The backend returns URLs like `/uploads/abc.jpg`; they work same-origin through the rewrite. Render them with `<Image src={url} unoptimized … />` or a plain `<img>`. Next 16 refuses to optimize images from local/private IPs by default, so don't fight that in dev.
