# Frontend (Next.js 16 App Router)

Each package builds its own pages in Milestone 2 (`modules.md` §1). Shared pieces (layout, header, `components/ui/`, `lib/api`, `lib/auth`, `proxy.ts`) are built once by the package that owns them per its ticket; don't create a second version.

How frontend code connects to the backend is in `api-contract.md`; read it too. Visual rules come from `/DESIGN.md`.

## Contents
1. Setup and commands
2. Route map
3. Server vs Client Components
4. Getting data
5. Auth in the frontend (proxy.ts, current user, role pages)
6. Rendering strategy per page (graded: be able to justify it)
7. Forms and validation
8. UI states and shared components
9. Styling and DESIGN.md
10. Metadata
11. Stripe payment page
12. Don'ts

## 1. Setup and commands

The app already exists (`frontend/`, created without Tailwind). Libraries are added by the tickets that need them: `react-hook-form zod @hookform/resolvers @stripe/stripe-js @stripe/react-stripe-js`, dev `openapi-typescript`.
Run: `npm run dev` (:3000) · Build: `npm run build` · Lint: `npm run lint` (ESLint) · Format: `npm run format` · Typecheck: `npm run typecheck` (generates Next's route types first) · All CI checks: `npm run verify` · API types: `npm run api:types`.
Leave `cacheComponents` **off** in `next.config.ts` (one consistent caching model for the team; §6 relies on it). `next.config.ts` holds the rewrites from api-contract.md §1.
`next dev` writes a version-matched `AGENTS.md` section that points to the docs bundled in `node_modules/next/`. Prefer those docs over memory.

## 2. Route map

```
src/
  proxy.ts                         # §5 (Next 16 name; NOT middleware.ts)
  app/
    layout.tsx  page.tsx (home: flight + hotel search)  not-found.tsx  error.tsx  global-error.tsx
    (auth)/login  (auth)/register  (auth)/change-password
    flights/page.tsx (results)  flights/[id]/page.tsx
    hotels/page.tsx (results)   hotels/[id]/page.tsx (details + free rooms for dates)
    book/flight/page.tsx (passengers → summary)   book/flight/[bookingId]/pay/page.tsx
    book/hotel/page.tsx (guests → summary)        book/hotel/[reservationId]/pay/page.tsx
    bookings/page.tsx (Upcoming/Past/Cancelled)   bookings/flights/[id]   bookings/hotels/[id]
    account/page.tsx (profile, currency, password, deactivate)   notifications/page.tsx
    itineraries/page.tsx (mine)  itineraries/new  itineraries/[id] (private view)  itineraries/[id]/edit
    explore/page.tsx (public itinerary search)  explore/[id]/page.tsx (public itinerary)
    blog/page.tsx (list + search)  blog/[id]/page.tsx  blog/tags/[tag]  blog/mine  blog/new  blog/[id]/edit
    authors/[id]/page.tsx
    moderator/airline/...  (profile, policies, flights, flights/[id] cabins + bookings + CSV)
    moderator/hotel/...    (profile, policies, rooms, rooms/[id] availability + blocks, reservations)
    admin/...              (accounts, moderators/new, providers, bookings, reports, audit-logs)
  components/ui/                   # primitives defined by DESIGN.md
  components/<feature>/            # flight-card.tsx, booking-countdown.tsx, ...
  lib/api/ server.ts client.ts errors.ts schema.d.ts (generated)
  lib/auth.ts                      # getCurrentUser, requireUser, requireRole
  lib/format.ts                    # money (minor units → display), dates in a time zone
```
Files are kebab-case; components are PascalCase exports. Route folders use URL words, not requirement IDs.

## 3. Server vs Client Components

- Default is a Server Component: fetch data, check auth, render HTML.
- Add `'use client'` only on the smallest component that needs state, effects, event handlers, browser APIs, or `useRouter`/`useSearchParams`/`usePathname`.
- Pattern: `page.tsx` (server) loads data and renders `<XxxClient initial={data} />` for the interactive part.
- Never import `lib/api/server.ts` or `lib/auth.ts` into a client file (`server-only` will fail the build, as intended).
- Props from server to client must be serializable (no class instances, no functions except Server Actions).
- `params` and `searchParams` are Promises: `const { id } = await params;`. Type them explicitly: `{ params: Promise<{ id: string }> }`.

## 4. Getting data

- Page data: in the Server Component via `serverFetch` (api-contract.md §5). No `useEffect` fetching for initial page data.
- User actions (like, book, save): Client Component → `apiFetch` → on success `router.refresh()` to re-run the server parts, or update local state.
- Search pages keep all criteria in the URL (`/flights?from=CAI&to=DXB&date=…`). The form pushes a new URL and the page reads `searchParams`. This makes back, refresh and sharing work (GEN-14) and preserves criteria when filtering (FLT-15).
- Run independent fetches in parallel: `const [a, b] = await Promise.all([...])`.

## 5. Auth in the frontend

`src/proxy.ts`: optimistic redirect and silent refresh. No database, no role decisions.
```ts
import { NextRequest, NextResponse } from 'next/server';
const PROTECTED = ['/bookings', '/book', '/account', '/notifications', '/itineraries', '/blog/new', '/blog/mine', '/moderator', '/admin', '/change-password'];

export async function proxy(req: NextRequest) {
  let clearCookies: string[] = [];
  if (!req.cookies.has('access_token') && req.cookies.has('refresh_token')) {
    const r = await fetch(`${process.env.BACKEND_URL}/api/auth/refresh`, {
      method: 'POST', headers: { cookie: req.headers.get('cookie') ?? '' } }).catch(() => null);
    const set = r?.headers.getSetCookie() ?? [];
    if (r?.ok) {
      const jar = new Map(req.cookies.getAll().map((c) => [c.name, c.value]));
      for (const c of set) { const pair = c.split(';')[0]; const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
      const headers = new Headers(req.headers);
      headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
      const res = NextResponse.next({ request: { headers } });   // this render sees the new cookie
      set.forEach((c) => res.headers.append('set-cookie', c));    // the browser stores it
      return res;
    }
    clearCookies = set;   // dead session: the backend's cookie-clearing headers, passed on to the browser
  }
  const { pathname, search } = req.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(p + '/'));
  let res = NextResponse.next();
  if (isProtected && !req.cookies.has('access_token')) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', pathname + search);
    res = NextResponse.redirect(url);
  }
  clearCookies.forEach((c) => res.headers.append('set-cookie', c));
  return res;
}
export const config = { matcher: ['/((?!api|uploads|_next/static|_next/image|favicon.ico|.*\\..*).*)'] };
```
`src/lib/auth.ts`:
```ts
import 'server-only';
export const getCurrentUser = cache(async (): Promise<Me | null> => {
  try { return await serverFetch<Me>('/auth/me'); }
  catch (e) { if (e instanceof ApiError && e.statusCode === 401) return null; throw e; }
});
export async function requireRole(...roles: Role[]) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.mustChangePassword) redirect('/change-password');
  if (roles.length && !roles.includes(me.role)) notFound();
  return me;
}
```
Call `requireRole(...)` at the top of **every** protected `page.tsx`, not only in a layout (layouts don't re-run on navigation). The backend still enforces everything; this only avoids rendering pages the user can't use.
Login and logout forms are Client Components calling `apiFetch('/auth/login', …)`. Then `router.replace(next ?? landingFor(me.role))` and `router.refresh()`.
Hide actions the user can't do (moderator buttons, owner-only edit) based on `me`; the backend still blocks them.

## 6. Rendering strategy per page (project PDF §9)

| Page | Strategy | How (cacheComponents off) |
|---|---|---|
| Blog post `blog/[id]`, author `authors/[id]`, public itinerary `explore/[id]` | ISR / static | `export const revalidate = 300;` `export async function generateStaticParams() { return []; }` Fetch with `cache: 'force-cache', next: { revalidate: 300, tags: ['post:<id>'] }`. **Don't** read cookies, headers or searchParams here. Likes, comments and the report button are client islands that fetch their own fresh data. |
| Blog list/search, public itinerary search, flight/hotel search, user bookings, private itinerary, moderator/admin dashboards | Dynamic SSR | `serverFetch` (no-store) and/or `await searchParams` makes the page dynamic automatically. |
| Blog editor, itinerary editor | Dynamic SSR + Client | Server page loads and authorizes; a `'use client'` editor handles interaction. |
| Likes and comments | Client Components | `apiFetch` plus optimistic UI. |

After an author publishes, edits or deletes a post (or changes an itinerary's visibility), call a Server Action that runs `revalidatePath('/blog/' + id)` (or `/explore/` + id, `/authors/` + authorId) so the static page updates immediately. Server Actions also verify the user before acting.
Be ready to explain each choice in the oral defense: public, rarely changing content uses ISR (fast, SEO); anything per-user or query-driven is dynamic.

## 7. Forms and validation

- `react-hook-form` + `zodResolver(schema)`; schemas live in `lib/validation/<feature>.ts` and mirror the backend DTO limits (requirements give the numbers).
- Show field errors under each input (GEN-02). On submit, map `ApiError.details` with `setError(field, { message })`; show `ApiError.message` for non-field errors.
- Disable the submit button while pending. Keep entered data on error (GEN-16).
- Money input and display: users see `12.50`; the API uses minor units (`totalMinor`). Convert only in `lib/format.ts`, using the currency's minor units.

## 8. UI states and shared components

- `loading.tsx` (or `<Suspense fallback>`) on every data-heavy route; `error.tsx` (`'use client'`, `reset` button) per area; `not-found.tsx` for 404s.
- `EmptyState` for lists and searches with no results (GEN-04), with a helpful next action.
- `ConfirmDialog` before delete, cancel, block, suspend or deactivate (GEN-03). For cancellations it shows the refund preview first.
- `Pagination` driven by the `page` search param, page size 10 (GEN-05).
- `Countdown` from `holdExpiresAt` on payment pages.
- Toasts for success and failure feedback (GEN-16). Notification bell with unread count in the header (GEN-01).
- Flight times always rendered with the airport's `timeZone` (GEN-06).

## 9. Styling and DESIGN.md

Before writing any UI, read `/DESIGN.md` and use its tokens, components and layout rules. Put primitives it defines in `components/ui/` and reuse them; don't restyle per page (GEN-17).
If `DESIGN.md` doesn't exist yet: plain CSS modules with semantic HTML and accessible labels. Don't install Tailwind, a component library or invent a brand; the styling stack is decided together with `DESIGN.md` (team leader).
Responsive (GEN-16): build mobile-first; check 375 px, 768 px and 1280 px.

## 10. Metadata

Public pages export `metadata` or `generateMetadata` (title and description; for posts, the title and an excerpt). Private pages set a plain title. Metadata only works in Server Components.

## 11. Stripe payment page

```tsx
'use client';
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);   // module scope, created once
export function PayStep({ clientSecret, returnPath }: { clientSecret: string; returnPath: string }) {
  return <Elements stripe={stripePromise} options={{ clientSecret }}><PayForm returnPath={returnPath} /></Elements>;
}
function PayForm({ returnPath }: { returnPath: string }) {
  const stripe = useStripe(); const elements = useElements();
  async function onPay() {
    if (!stripe || !elements) return;
    const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required',
      confirmParams: { return_url: window.location.origin + returnPath } });
    if (error) { /* show error.message; the user may retry until the hold expires */ return; }
    /* poll GET /api/<type>-bookings/:id until status === 'confirmed', then show confirmation */
  }
  return (<form onSubmit={(e) => { e.preventDefault(); onPay(); }}><PaymentElement /><button disabled={!stripe}>Pay</button></form>);
}
```

## 12. Don'ts

- `middleware.ts`, `next/router`, `getServerSideProps`, or the `pages/` directory. These are old patterns; use the App Router and `next/navigation`.
- Synchronous `params`, `searchParams` or `cookies()`.
- Calling `http://localhost:4000` from the browser. Always use `/api/...`.
- Tokens or user objects in `localStorage` or `sessionStorage`; reading cookies in client JS.
- `'use client'` on whole pages "to make it work". Find the interactive leaf.
- Trusting frontend checks for security, or computing prices the backend will charge.
