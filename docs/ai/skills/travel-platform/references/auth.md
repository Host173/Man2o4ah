# Auth, sessions, roles, ownership

Covers ACC-01, 04–19, GEN-13. Owned by the **accounts** module (Accounts & Auth package). Backend and frontend both depend on this file; don't change cookie names, paths or error codes without the team leader's approval. Field definitions: `docs/database/data-model.md` §3.2.

## Contents
1. Roles and account fields
2. Cookies and tokens
3. Sessions (idle expiry, revocation)
4. Login, lockout, register, passwords
5. Guards and decorators
6. Ownership and moderator scope
7. Frontend side

## 1. Roles and account fields

`role`: `user` · `admin` · `airline_moderator` · `hotel_moderator`.
`status`: `active` · `suspended` (admin action) · `deactivated` (self, ACC-12).
User (`users`): `name, email (lowercased, unique), passwordHash (select:false), role, status, phone?, preferredCurrency (default 'USD'), moderatorOf? { providerType: airline|hotel, providerId } (moderators only), mustChangePassword, termsAcceptedAt?, failedLoginAttempts, lockedUntil?`.
Admins exist only through the seed script (ACC-18); registration always creates role `user`.

## 2. Cookies and tokens

| Cookie | Content | Path | Lifetime |
|---|---|---|---|
| `access_token` | JWT `{ sub, role, sid, providerId? }` (`providerId` = `moderatorOf.providerId`), HS256, `JWT_ACCESS_SECRET` | `/` | 15 min (cookie `maxAge` = token TTL) |
| `refresh_token` | 48 random bytes, base64url; only its SHA-256 hash is stored | `/` | 7 days absolute |

The refresh cookie uses path `/` on purpose: `proxy.ts` must see it on page navigations to refresh silently. Both cookies: `httpOnly: true, secure: true, sameSite: 'lax'`. Browsers accept `secure` cookies on `http://localhost`. Set them with Express `res.cookie()` (milliseconds) via `@Res({ passthrough: true })`, and clear them with `res.clearCookie(name, { path })` using the same path.
Never put email, name or anything sensitive in the JWT. Never return tokens in a JSON body.

## 3. Sessions

Collection `sessions`: `userId, refreshTokenHash, lastActivityAt, expiresAt` with a **TTL index on `expiresAt`** (`expiresAt = lastActivityAt + 30 min`). A session that exists and has `expiresAt > now` is live; anything else is dead. Revoking = deleting.

- **Idle expiry (ACC-06):** the guard rejects a missing session, or one with `expiresAt ≤ now` (TTL deletion can lag ~60 s), with `401 SESSION_EXPIRED`.
- **Activity:** the guard slides `lastActivityAt` and `expiresAt` at most once per 60 s per session (`updateOne({ _id: sid, lastActivityAt: { $lt: now - 60s } }, { $set: { lastActivityAt: now, expiresAt: now + 30 min } })`).
- **Delete all of a user's sessions** when they change their password, are reset by an admin, suspended or deactivated. It takes effect on their next request.
- **Refresh** `POST /api/auth/refresh` (public): hash the cookie, find a live session with that hash, slide its activity, issue a new access token, and set the `access_token` cookie. The refresh token is **not** rotated: several parallel requests (prefetches) may refresh at once, and rotation would make all but one fail. Logout, idle expiry and revocation still kill it. Anything else gets `401 SESSION_EXPIRED` and both cookies are cleared.
- **Logout** `POST /api/auth/logout`: delete the session and clear both cookies (ACC-06).

## 4. Login, lockout, register, passwords

Login `POST /api/auth/login`, in this order:
1. Find the user by lowercased email with `+passwordHash`. If there's no user or the account is `deactivated`, return `401 INVALID_CREDENTIALS` "Invalid email or password".
2. If `lockedUntil > now`, return `401 ACCOUNT_LOCKED` with the minutes remaining (ACC-05).
3. If `bcrypt.compare` fails, increment `failedLoginAttempts` atomically (`$inc`, never read-then-write). At 5, set `lockedUntil = now + 15 min` and reset the count, then return `ACCOUNT_LOCKED`; otherwise return `INVALID_CREDENTIALS`.
4. If the password is right but status is `suspended`, return `403 ACCOUNT_SUSPENDED` "Your account is suspended" (ACC-04).
5. Reset `failedLoginAttempts`, create a session, set cookies, return `{ user: MeDto }`.

`MeDto` (`GET /api/auth/me`): `{ _id, name, email, role, status, preferredCurrency, moderatorOf?, mustChangePassword }`.

Password rule (ACC-01, shared by ACC-07a, ACC-08, ACC-13): 8 to 72 characters with at least one letter and one digit, `/^(?=.*[A-Za-z])(?=.*\d).{8,72}$/`, in one place: `accounts/auth/password-rule.ts` (`PASSWORD_RULE`, `PASSWORD_RULE_MESSAGE`). The 72 cap (team leader, 17 Nov, #126; `docs/DECISIONS.md` §3): bcrypt ignores everything after 72 bytes. It counts characters, not UTF-8 bytes, so non-ASCII passwords can still go past 72 bytes; whether to count bytes is an open item for the team leader. It is applied in DTOs to new passwords only; login and the current password on change-password accept any non-empty string, so temporary passwords and passwords stored before the cap still work.

Register (ACC-01): `name`, `email` (`@IsEmail`), `password` matching the password rule, `acceptTerms: true` (`@Equals(true)`). Duplicate email returns `409 EMAIL_TAKEN` (catch Mongo 11000). Hash with `bcrypt.hash(pw, 12)`. Store `termsAcceptedAt`. Don't log the user in automatically unless the team decides to.

Temporary passwords (ACC-07a, ACC-13): the admin sets one, the backend stores the hash, sets `mustChangePassword = true` and deletes the user's sessions. While `mustChangePassword` is true, the guard allows only `GET /auth/me`, `PATCH /auth/change-password` and `POST /auth/logout` and returns `403 PASSWORD_CHANGE_REQUIRED` for anything else.
Change password (ACC-08) `PATCH /api/auth/change-password` `{ currentPassword, newPassword }`: requires the current password (wrong → `400 VALIDATION_FAILED` with `details` on `currentPassword`, not 401, since the caller is still logged in); the new one follows the password rule; during a forced change (`mustChangePassword`), a new password that still matches the temporary one (checked with `bcrypt.compare` against the stored hash) gets `400 VALIDATION_FAILED` on `newPassword`, while a normal change may keep the same password; store a new bcrypt hash and clear `mustChangePassword` in one update conditional on the old hash; delete the user's other sessions (the calling session stays logged in). Returns `204`, no cookie changes.

## 5. Guards and decorators

Register globally in `AuthModule`:
```ts
providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }]
```
Order matters: authentication first, then roles. Everything is protected unless marked `@Public()`.

```ts
export const IS_PUBLIC = 'isPublic';  export const Public = () => SetMetadata(IS_PUBLIC, true);
export const ROLES = 'roles';         export const Roles = (...r: Role[]) => SetMetadata(ROLES, r);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as AuthUser);
```
`JwtAuthGuard.canActivate`:
1. If `reflector.getAllAndOverride(IS_PUBLIC, [handler, class])` is true, try to attach the user if a valid cookie exists (so public pages can personalize), and always return true.
2. Read `req.cookies.access_token`. If it's missing, return `401 NOT_AUTHENTICATED`.
3. `jwtService.verifyAsync`. On failure, return `401 TOKEN_EXPIRED`; the frontend then calls refresh.
4. Load the session by `sid` (lean). If it's missing or `expiresAt ≤ now`, return `401 SESSION_EXPIRED`. Slide the activity time.
5. Enforce the `mustChangePassword` allow-list, then set `req.user = { id: sub, role, providerId, sid }`.

`RolesGuard`: no `@Roles` metadata means any logged-in user may pass. Otherwise a role not in the list gets `403 FORBIDDEN_ROLE`. Use `ForbiddenException`, not `UnauthorizedException`.

## 6. Ownership and moderator scope (ACC-11)

Ownership is checked in **services**, after loading the resource:
- Owner-only resources (bookings, private itineraries, drafts, own comments): if `doc.userId` is not `user.id` and the role is not allowed, throw `NotFoundException` so the resource's existence doesn't leak. Admins may **read** all bookings (ACC-17), never modify them.
- Moderators: the resource's `airlineId` or `hotelId` must equal `user.providerId`; otherwise throw 404. A moderator's create calls take the provider from `user.providerId`, never from the body.
- Query by ownership instead of filtering afterwards: `bookingModel.findOne({ _id: id, userId: user.id })`.
- Public reads of user content exclude `isHidden` items and items with `authorDeactivated` (ACC-12, GEN-10), except for the author and admins.

## 7. Frontend side (details in frontend.md and api-contract.md)

- Never read tokens in JS. Login and logout run in the **browser** through the `/api` rewrite so the `Set-Cookie` headers land on the frontend origin.
- Current user: Server Components call `getCurrentUser()` (server fetch of `/api/auth/me`, cached per request with React `cache`). Client Components receive the user as props or through a context filled by the root layout.
- `proxy.ts` performs optimistic redirects only (no cookie means redirect to `/login?next=…`) and silently refreshes expired access tokens (frontend.md §5). Real checks stay in the backend.
- Role landing pages after login: `user` → `/`, `admin` → `/admin`, `airline_moderator` → `/moderator/airline`, `hotel_moderator` → `/moderator/hotel`. If `mustChangePassword` is set, go to `/change-password` first.
- ACC-10: restricted actions send guests to `/login?next=<current path>`. After login, redirect to `next` only if it starts with `/` and not `//`.

## 8. Account events and checks (ACC-12, ACC-15, ACC-16)

- **Self-deactivation (ACC-12):** blocked with 409 while `ActiveBookingsCheck.hasUpcomingConfirmed(userId)` is true (a port the booking modules implement; accounts never imports them). Otherwise set `deactivated`, delete sessions, emit `user.deactivated`.
- **Suspend / reactivate (ACC-15, ACC-16):** called by admin. Set the status, delete sessions on suspension, emit `account.suspended` / `account.reactivated`. Bookings stay valid; content stays visible unless hidden.
- Events are emitted after the write commits; notifications and audit react to them.
