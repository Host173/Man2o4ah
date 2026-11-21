# GEN-01-B: email notification contract proposal

**Proposal only: email delivery is not implemented. Do not merge this draft until
the prerequisite contracts/model are approved and the feature is implemented and
validated. Merging a GEN-01b PR automatically closes #94.**

GEN-01 (#19, PR #168) is merged. Pierre confirmed Kareem and Aisha's approval of
the proposed direction, not of every field or policy below. This document makes
those remaining decisions explicit for review. It does not change locked
decisions, publish executable contracts, or replace the frozen data model.

Sources: [requirements](../ai/skills/travel-platform/references/requirements.md),
[locked decisions](../DECISIONS.md), [data model](../database/data-model.md),
[module rules](../ai/skills/travel-platform/references/modules.md), and
[testing rules](../ai/skills/travel-platform/references/testing.md).

## Approval responsibilities

- **Kareem:** notification-owned contracts/model, shared event and configuration
  changes, SMTP dependency, delivery policy, scheduling and final merge.
- **Aisha:** Accounts-owned recipient adapter, module registration and invitation
  emission. Existing account creation and authentication behavior must remain.
- **Both:** agree the exact contracts and reliability limits below. Approved
  schema changes need a separate prerequisite PR with model documentation,
  diagrams, schema and index tests together, before GEN-01b uses them.
- The prerequisite PR's ticket key is for the team leader to provide; this draft
  does not invent one or implement another ticket.

## Recipient port

Notifications owns a port and exports its registry. Accounts implements it and
registers in `onModuleInit`. Notifications never imports Accounts, its schema or
model, and never reads its collection.

```ts
export interface EmailRecipient {
  userId: string;
  email: string;
}

export interface EmailRecipientLookup {
  getRecipient(userId: string): Promise<EmailRecipient | null>;
}
```

- Accept a canonical 24-hex ObjectId string; return only this user's ID and email.
- Unknown account returns `null`. Suspended/deactivated accounts can receive
  required alerts: inability to log in is not an email opt-out.
- Malformed IDs throw `BadRequestException` with `ErrorCode.ValidationFailed`.
  Database/configuration failures reject; they never masquerade as `null`.
- Do not expose name, role, hash, temporary password, session or token.
  Existing `AccountProfile` remains unchanged and excludes email.
- `EmailRecipientRegistry` exposes `register(lookup)` and `getRecipient(userId)`.
  Duplicate/missing registration throws a wiring error, matching existing
  registries. No silent default implementer or Accounts `ModuleRef` lookup.
- An Accounts-owned `AccountEmailRecipient` injects its own User model and the
  registry. Accounts imports NotificationsModule to register it; Notifications
  exports only the registry, not MongooseModule/models.
- Update the allowed-import/port tables for this dependency-inverted
  registration. No module cycle or cross-module `populate` is permitted.
- `FakeEmailRecipientLookup` belongs in the existing fakes directory, implements
  `PublicApi<AccountEmailRecipient>`, reproduces contract errors, and is exported
  from the fakes index.

## Moderator invitation event

```ts
// Add to Events and the typed EventPayloads mapping.
ModeratorInvited: 'moderator.invited'

export interface ModeratorInvitedEvent {
  eventId: string;
  userId: string;
}
```

- Accounts emits through `AppEvents` after moderator creation succeeds/commits.
  Rejected or duplicate-email creation emits nothing.
- One stable identity per created account, proposed as
  `moderator-created:${userId}`; redelivery retains it.
- No email, password, token or provider details travel in the payload.
  Notifications obtains the destination through the port.
- Add only the approved event hook to existing account creation. Do not
  reimplement ACC-13, add an invitation endpoint, or repurpose `admin.action`.
- Emit outside creation-error mapping catches, so an emission failure cannot be
  misreported as invalid input after the account already exists.
- Proposed subject: **Moderator invitation**. Plain text explains that the
  account is ready, the administrator supplies the temporary password
  separately, and first login requires a password change.
- Include a login link derived from existing `FRONTEND_URL`. The reviewed
  frontend has no login page: **agree the actual target route before use**.
  Do not claim an invented `/login` route currently works.

No emailed credentials, verification-token flow or password-reset feature.

## Notifications-owned delivery collection

Propose `email_deliveries`; leave existing notification fields/indexes unchanged.
Use default ObjectId `_id`, `timestamps: true`, ObjectId props declared as
`MongooseSchema.Types.ObjectId`, and no `ref`.

| Field | Proposed type and invariant |
| --- | --- |
| `deliveryKey` | Required non-empty string; globally unique. |
| `kind` | Required `notification \| moderator_invitation`. |
| `userId` | Required ObjectId; recipient resolved through the port. |
| `notificationId` | ObjectId, required for notification rows and forbidden for invitations; references this module's stored notification. |
| `invitationEventId` | Non-empty string, required for invitation rows and forbidden for notification rows. |
| `status` | `pending \| sending \| sent \| failed`; default `pending`. |
| `attempts` | Required non-negative safe integer; default `0`. |
| `nextAttemptAt` | Required UTC Date; default insertion time. |
| `leaseToken` | Non-empty string only while `sending`. |
| `leaseExpiresAt` | UTC Date only while `sending`. |
| `sentAt` | UTC Date only when `sent`. |
| `lastError` | Optional fixed category from the list below; never a raw exception. |

Error categories: `recipient_missing`, `recipient_lookup_failed`,
`smtp_transient`, `smtp_rejected`, `smtp_unknown`, `notification_missing`,
`attempts_exhausted`.

Do not persist recipient email, credentials, message bodies or SMTP replies in
the delivery row. Render notifications from their immutable stored content and
invitations from the agreed fixed template.

Exact proposed indexes:

```text
{ deliveryKey: 1 }                         unique
{ status: 1, nextAttemptAt: 1, _id: 1 }
{ status: 1, leaseExpiresAt: 1, _id: 1 }
```

Keys: `notification:${notificationId}` and
`invitation:${invitationEventId}:${userId}`. Retain existing GEN-01 identities,
including stable `eventId` for repeatable changes. Never deduplicate using read
state, latest account state, time windows or email address.

No TTL deletion: removing sent/failed rows removes deduplication history.
Retention/archival and new HTTP endpoints are out of scope.

## Claim, retry and delivery behavior

The following constants and policies are **proposed, not locked decisions**:

- Scan every 30 seconds, processing up to 20 rows sequentially per scan.
- Five attempts total; retry delays after attempts 1-4: 30, 60, 120, 240 seconds.
- SMTP connection/greeting/socket timeouts: 15 seconds each; lease: 120 seconds.
- Atomically claim a due `pending` row: set `sending`, increment attempts,
  and assign a fresh token/lease.
- Acknowledge or reschedule only with `{ _id, status: sending, leaseToken }`.
  Check every update result. Stale workers cannot acknowledge newer claims.
- SMTP acceptance transitions to `sent`, sets `sentAt`, and removes lease fields.
- Transient SMTP/network/lookup failures return to `pending` with a due time.
  Recipient absence, missing notification and SMTP 5xx rejection are permanent.
- Exhaustion transitions to `failed`. Redelivery never resurrects sent/failed
  rows. Expired leases return to pending using a conditional ownership filter;
  if attempts are already exhausted, terminate instead of making another send.
- Explicit Nest logs contain delivery/event IDs and fixed categories only:
  no addresses, message bodies, credentials or raw SMTP errors/replies.

When enabled, enqueue the stored notification and its delivery row in the same
notifications-owned MongoDB transaction; pass the session to every database
operation. Never call SMTP inside a transaction.
Keep `NotificationsService.create(items): Promise<number>` unchanged: it counts
new in-app notifications, not queued/sent emails.

Redelivery can restore a missing queue row under the same identity, but cannot
reset read state or sent/failed deliveries. Handle duplicate-key races outside
aborted transactions, retrying the existing identity in a fresh transaction.
Invitation listeners idempotently enqueue after account creation commits, without
creating an in-app invitation. Enqueue failures are logged explicitly.

### Reliability limits to approve

**SMTP cannot guarantee exactly-once delivery.** SMTP may accept a message before
the worker crashes without persisting `sent`; retry can then send it again.
Guarantee durable retries once enqueued, concurrent claim suppression, and no
resend of persisted sent records. Use a deterministic Message-ID derived from
`deliveryKey` and the validated sender domain, without claiming inboxes must
deduplicate it.

Existing in-process events are **not a durable source outbox**. A crash after a
source commit but before listener enqueue can lose an event. This queue does not
fix that gap. A cross-module source outbox needs another approved design and must
not be silently added to GEN-01b.

## SMTP dependency and configuration

Proposed/approved direction: a notifications-owned Nodemailer adapter. Review
`nodemailer` and `@types/nodemailer` if the selected version needs external types.
Select supported versions in the implementation PR, then install only after a
manifest change. No dependency is installed by this documentation draft.

First-party [Nest mail](https://docs.nestjs.com/application/mail.md) was checked:
it supports SMTP and in-memory transports. It is an alternative, not a second
package to add. Keep Nodemailer unless Kareem changes the approved direction.
See [Nodemailer SMTP](https://nodemailer.com/smtp).

Use `ConfigService`, explicit options, plain text, one recipient per send, no raw
protocol logging, and no disabled TLS certificate verification.

Proposed variable names:

```text
SMTP_ENABLED
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
SMTP_TEST_INBOX
```

- Optional strict boolean-string `SMTP_ENABLED`; default disabled.
- When disabled, preserve all in-app behavior, enqueue/send nothing, and log
  once that email is disabled. Later enabling does not backfill old events.
  Irrelevant SMTP settings do not block normal disabled startup.
- Enabled: non-empty host, integer port 1-65535, strict boolean-string
  `SMTP_SECURE`, single valid sender mailbox; auth user/password both present
  or both absent for local test sinks.
- Use existing `NODE_ENV`. Every enabled non-production run requires a valid
  `SMTP_TEST_INBOX`: both header and envelope destinations go only there.
  Never expose the real account email in headers/text or silently fall back.
- Production uses the resolved recipient and requires TLS: implicit TLS or
  mandatory STARTTLS. Local non-production sinks may use plaintext.
- Validate subject/body/login target and reject header injection. Do not relay
  raw SMTP errors to logs or HTTP clients.
- Add variable names/configuration documentation to the API-contract reference
  and `.env.example` only with their approved implementation. No feature README
  sections, credentials or real inbox values.

## Prerequisite PR and feature implementation boundary

The separate prerequisite PR publishes the approved model/contracts:

- Recipient port/registry, Accounts adapter/registration and typed fake.
- Typed invitation event and Accounts emission hook.
- Delivery schema/registration, field validation and exact index manifest.
- Synchronized data model, class diagrams, collection counts, port/event tables,
  agreed retry-job contract and locked-decision record.
- Coupled contract/method comments, fake exports and tests.

It does not implement the SMTP transport or worker. After it merges, GEN-01b adds
transactional enqueue, invitation enqueue, the SMTP adapter/worker, configuration,
integration tests and full backend verification. No new error code is proposed.
No frontend changes, account verification, password reset or other ticket work.

## Required validation

Prerequisite tests: port wiring and plain-view contract; unknown/malformed and
suspended/deactivated recipients; post-persistence invitation emission without
credentials; no event on duplicate creation; schema/cross-field/ObjectId rules;
concurrent unique-key invariant; exact indexes and collection registry; typed fakes.

GEN-01b integration tests use `createTestApp`, `clearCollections`, in-memory MongoDB
and deterministic mocked SMTP. Use `loginAs` where HTTP auth is exercised:

- All ten existing listener events, refund statuses and provider recipients;
  moderator invitation content and destination.
- Development header/envelope test-inbox override; no real recipient/credentials.
- Sequential/concurrent duplicate delivery, distinct stable event IDs, read-state
  independence, persisted sent records across restart, and lease ownership.
- Transient error then retry/success; permanent failure; exhausted retry;
  expired lease recovery and stale worker acknowledgement.
- Atomic enqueue failure without partial notification/queue; disabled mode;
  invalid configuration and missing test inbox fail before any send.
- Acceptance followed by failed acknowledgement exercises the documented possible
  duplicate, not an impossible exactly-once assertion.

`Promise.allSettled` tests assert invariants, not winners. Preserve every existing
GEN-01 test. Never read `.env`, contact Atlas or send live mail.
Run focused selectors covering actual changed files, then `npm run verify` in
each changed app. Every changed backend service needs at least 80% line coverage.

This draft changes documentation and an append-only prompt log only. Application
build/tests/verify are not required or claimed for this draft; executable
validation remains a gate before feature completion and merge.
