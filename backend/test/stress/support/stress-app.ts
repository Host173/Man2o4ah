import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { HealthModule } from '../../../src/health/health.module.js';
import { AccountsSeedModule } from '../../../src/modules/accounts/seed/accounts-seed.module.js';
import { AdminSeedService } from '../../../src/modules/accounts/seed/admin-seed.service.js';
import { AdminModule } from '../../../src/modules/admin/admin.module.js';
import { AuditModule } from '../../../src/modules/audit/audit.module.js';
import { BlogModule } from '../../../src/modules/blog/blog.module.js';
import { PostImageCleanupJob } from '../../../src/modules/blog/post-image-cleanup.job.js';
import { FlightBookingsModule } from '../../../src/modules/flight-bookings/flight-bookings.module.js';
import { FlightCompletionJob } from '../../../src/modules/flight-bookings/flight-completion.job.js';
import { FlightHoldExpiryJob } from '../../../src/modules/flight-bookings/flight-hold-expiry.job.js';
import { FlightsModule } from '../../../src/modules/flights/flights.module.js';
import { FlightsService } from '../../../src/modules/flights/flights.service.js';
import { FX_RATES_CLIENT } from '../../../src/modules/fx/fx-rates.client.js';
import type { FxRatesClient } from '../../../src/modules/fx/fx-rates.client.js';
import { FxRatesService } from '../../../src/modules/fx/fx-rates.service.js';
import { FxModule } from '../../../src/modules/fx/fx.module.js';
import { HotelBookingsModule } from '../../../src/modules/hotel-bookings/hotel-bookings.module.js';
import { HotelHoldExpiryJob } from '../../../src/modules/hotel-bookings/hotel-hold-expiry.job.js';
import { HotelStayCompletionJob } from '../../../src/modules/hotel-bookings/hotel-stay-completion.job.js';
import { HotelsModule } from '../../../src/modules/hotels/hotels.module.js';
import { ItinerariesModule } from '../../../src/modules/itineraries/itineraries.module.js';
import { ModerationModule } from '../../../src/modules/moderation/moderation.module.js';
import { NotificationsModule } from '../../../src/modules/notifications/notifications.module.js';
import { PaymentsModule } from '../../../src/modules/payments/payments.module.js';
import { STRIPE_GATEWAY } from '../../../src/modules/payments/stripe/stripe-gateway.js';
import type { GatewayRefundStatus } from '../../../src/modules/payments/stripe/stripe-gateway.js';
import { ReferenceDataModule } from '../../../src/modules/reference-data/reference-data.module.js';
import { ReferenceDataSeedService } from '../../../src/modules/reference-data/seed/reference-data-seed.service.js';
import { StorageModule } from '../../../src/modules/storage/storage.module.js';
import { createDemoApi } from '../../../src/seed/demo/demo-api.js';
import { buildDemoPlan } from '../../../src/seed/demo/demo-plan.js';
import type { DemoPlan } from '../../../src/seed/demo/demo-plan.js';
import { runDemoSeed } from '../../../src/seed/demo/demo-seed.js';
import {
  FAKE_STRIPE_SIGNATURE,
  FakeStripeGateway,
} from '../../fakes/stripe-gateway.fake.js';
import { createTestApp, type TestApp } from '../../support/test-app.js';

export const DEMO_PASSWORD = 'Demo12345';
export const ADMIN = { email: 'admin@example.com', password: 'Admin12345' };
export const PLATFORM_CURRENCY = 'USD';
export const DAY_MS = 86_400_000;

/** The rates the fake FX client answers with (per 1 USD). */
export const FAKE_RATES: Record<string, number> = {
  USD: 1,
  EGP: 48.5,
  EUR: 0.92,
  GBP: 0.79,
  AED: 3.6725,
  SAR: 3.75,
  JPY: 151.2,
};

/**
 * The FX API client, faked (ITN-18): answers `FAKE_RATES` until `down` is set,
 * then throws like a failed HTTP call.
 */
export class FakeFxClient implements FxRatesClient {
  down = false;
  calls = 0;
  async fetchLatest(
    _base: string,
    currencies: string[],
  ): Promise<Record<string, number>> {
    this.calls += 1;
    if (this.down) throw new Error('FakeFxClient: the FX API is down');
    const rates: Record<string, number> = {};
    for (const code of currencies) rates[code] = FAKE_RATES[code] ?? 1;
    return rates;
  }
}

// ---------------------------------------------------------------- findings

export interface Finding {
  area: string;
  attack: string;
  expected: string;
  got: string;
  broken: string[];
}

/**
 * Collects every probe's outcome for one area and writes them to
 * `test/stress/out/<area>.json` (gitignored). A probe records several checks;
 * none throws, so one probe reports everything it saw.
 */
export class Findings {
  readonly all: Finding[] = [];
  constructor(readonly area: string) {}

  /** One check: `ok` false adds it to `broken`. Returns `ok`. */
  record(
    attack: string,
    expected: string,
    got: unknown,
    ok: boolean,
    broken: string[] = [],
  ): boolean {
    this.all.push({
      area: this.area,
      attack,
      expected,
      got: typeof got === 'string' ? got : JSON.stringify(got),
      broken: ok ? broken : [expected, ...broken],
    });
    return ok;
  }

  brokenOf(attack: string): Finding[] {
    return this.all.filter(
      (finding) => finding.attack === attack && finding.broken.length > 0,
    );
  }

  write(): void {
    const dir = join(import.meta.dirname, '..', 'out');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${this.area}.json`),
      `${JSON.stringify(this.all, null, 2)}\n`,
    );
  }
}

/**
 * Runs one probe: `body` records its checks through `check`; at the end the
 * probe fails with every broken check (rule + what was seen), and the global
 * invariants are checked too.
 */
export function probeRunner(s: () => Stress, findings: Findings) {
  return async (
    attack: string,
    body: (
      check: (expected: string, got: unknown, ok: boolean) => boolean,
    ) => Promise<void>,
    options: { invariants?: boolean } = {},
  ): Promise<void> => {
    let crashed: unknown;
    try {
      await body((expected, got, ok) =>
        findings.record(attack, expected, got, ok),
      );
    } catch (error) {
      crashed = error;
      findings.record(
        attack,
        'the probe runs to the end',
        error instanceof Error ? (error.stack ?? error.message) : error,
        false,
      );
    }
    if (options.invariants !== false) {
      const broken = await s().invariants();
      findings.record(
        attack,
        'global invariants hold after the attack',
        broken,
        broken.length === 0,
        broken,
      );
    }
    findings.write();
    const failed = findings.brokenOf(attack);
    if (failed.length > 0) {
      const lines = failed.map(
        (finding) => `- ${finding.broken.join(' / ')} | got: ${finding.got}`,
      );
      const message = `${attack}: broken rule(s)\n${lines.join('\n')}`;
      if (crashed instanceof Error) crashed.message = message;
      throw crashed instanceof Error ? crashed : new Error(message);
    }
  };
}

// ------------------------------------------------------------------ actors

export type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** A logged-in (or anonymous) client: every call carries its cookies. */
export interface Actor {
  id: string;
  email: string;
  role: string;
  providerId?: string;
  cookie: string;
  req: (method: Method, path: string) => request.Test;
  get: (path: string) => request.Test;
  post: (path: string, body?: unknown) => request.Test;
  patch: (path: string, body?: unknown) => request.Test;
  put: (path: string, body?: unknown) => request.Test;
  del: (path: string) => request.Test;
}

function cookieHeader(setCookie: string[] | string | undefined): string {
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  return list
    .map((header) => header.split(';')[0])
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

// ------------------------------------------------------------------- world

export interface World {
  plan: DemoPlan;
  today: string;
  airlines: Record<string, { id: string; moderator: string }>;
  hotels: Record<string, { id: string; moderator: string }>;
  users: string[];
}

export interface Stress {
  t: TestApp;
  stripe: FakeStripeGateway;
  fx: FakeFxClient;
  world: World;
  baseUrl: string;
  unhandled: unknown[];
  as: (email: string, password?: string) => Promise<Actor>;
  guest: () => Actor;
  newUser: (tag: string) => Promise<Actor>;
  col: (name: string) => ReturnType<Connection['collection']>;
  jobs: {
    flightExpiry: (now?: Date) => Promise<number>;
    hotelExpiry: (now?: Date) => Promise<number>;
    flightCompletion: (now?: Date) => Promise<number>;
    hotelCompletion: (now?: Date) => Promise<number>;
    postImageCleanup: () => Promise<void>;
    markDeparted: (now?: Date) => Promise<number>;
    fxRefresh: () => Promise<unknown>;
  };
  payWebhook: (
    paymentIntentId: string,
    type?: 'payment_intent.succeeded' | 'payment_intent.payment_failed',
    eventId?: string,
  ) => request.Test;
  refundWebhook: (
    stripeRefundId: string,
    status: GatewayRefundStatus,
    ourRefundId: string,
    eventId?: string,
  ) => request.Test;
  invariants: (options?: { expiryRanAt?: Date }) => Promise<string[]>;
  close: () => Promise<void>;
}

export async function parallel<T>(
  n: number,
  fn: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
}

/** Polls `fn` until it returns a truthy value (events run after the response). */
export async function eventually<T>(
  fn: () => Promise<T>,
  timeoutMs = 5_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!last && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    last = await fn();
  }
  return last;
}

/** Lets the in-process event listeners finish (they run after the response). */
export function settle(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function statuses(
  results: PromiseSettledResult<request.Response>[],
): number[] {
  return results.map((r) => (r.status === 'fulfilled' ? r.value.status : -1));
}

export function countOf(values: number[], value: number): number {
  return values.filter((v) => v === value).length;
}

/** `YYYY-MM-DD`, `days` after today (UTC). */
export function dateIn(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

let eventSequence = 0;
function nextEventId(): string {
  eventSequence += 1;
  return `evt_stress_${Date.now()}_${eventSequence}`;
}

let userSequence = 0;

/**
 * The whole app (every feature module `app.module.ts` imports) on the
 * in-memory replica set. Only Stripe and the FX API are faked; the modules
 * talk to each other for real. Seeds the reference data, one exchange-rates
 * document, the admin (as ACC-18 does) and PLT-08's demo world through the
 * HTTP API, so every attack starts from the world graders see.
 */
export async function createStressApp(): Promise<Stress> {
  const stripe = new FakeStripeGateway();
  const fx = new FakeFxClient();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  const t = await createTestApp({
    imports: [
      HealthModule,
      AccountsSeedModule,
      ReferenceDataModule,
      FlightsModule,
      FlightBookingsModule,
      HotelsModule,
      HotelBookingsModule,
      PaymentsModule,
      ItinerariesModule,
      FxModule,
      BlogModule,
      ModerationModule,
      AdminModule,
      NotificationsModule,
      AuditModule,
      StorageModule,
    ],
    override: (builder) =>
      builder
        .overrideProvider(STRIPE_GATEWAY)
        .useValue(stripe)
        .overrideProvider(FX_RATES_CLIENT)
        .useValue(fx),
  });
  await t.moduleRef.get(ReferenceDataSeedService).run();
  await t.moduleRef.get(FxRatesService, { strict: false }).refresh();
  await t.moduleRef
    .get(AdminSeedService, { strict: false })
    .run({ email: ADMIN.email, password: ADMIN.password });
  await t.app.listen(0, '127.0.0.1');
  const { port } = t.app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const today = new Date().toISOString().slice(0, 10);
  const plan = buildDemoPlan({
    password: DEMO_PASSWORD,
    adminEmail: ADMIN.email,
    adminPassword: ADMIN.password,
    today,
  });
  await runDemoSeed(createDemoApi(`${baseUrl}/api`), plan, () => undefined);

  const http = () => request(t.app.getHttpServer());

  function actor(
    cookie: string,
    who: { id: string; email: string; role: string; providerId?: string },
  ): Actor {
    const req = (method: Method, path: string) => {
      const call = http()[method](`/api${path}`);
      return cookie ? call.set('Cookie', cookie) : call;
    };
    return {
      ...who,
      cookie,
      req,
      get: (path) => req('get', path),
      post: (path, body) => req('post', path).send(body as object),
      patch: (path, body) => req('patch', path).send(body as object),
      put: (path, body) => req('put', path).send(body as object),
      del: (path) => req('delete', path),
    };
  }

  async function as(email: string, password?: string): Promise<Actor> {
    const pw =
      password ?? (email === ADMIN.email ? ADMIN.password : DEMO_PASSWORD);
    const response = await http()
      .post('/api/auth/login')
      .send({ email, password: pw });
    if (response.status !== 200) {
      throw new Error(
        `login ${email} failed: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    const user = response.body.user as {
      _id: string;
      role: string;
      moderatorOf?: { providerId: string };
    };
    return actor(cookieHeader(response.headers['set-cookie']), {
      id: user._id,
      email,
      role: user.role,
      providerId: user.moderatorOf?.providerId,
    });
  }

  async function newUser(tag: string): Promise<Actor> {
    userSequence += 1;
    const email =
      `stress.${tag}.${userSequence}.${Date.now()}@example.com`.toLowerCase();
    const response = await http()
      .post('/api/auth/register')
      .send({
        name: `Stress ${tag} ${userSequence}`,
        email,
        password: DEMO_PASSWORD,
        acceptTerms: true,
      });
    if (response.status !== 201) {
      throw new Error(
        `register ${email} failed: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    return as(email);
  }

  const world: World = { plan, today, airlines: {}, hotels: {}, users: [] };
  for (const airline of plan.airlines) {
    const mod = await as(airline.moderator.email);
    world.airlines[airline.code] = {
      id: mod.providerId!,
      moderator: airline.moderator.email,
    };
  }
  for (const hotel of plan.hotels) {
    const mod = await as(hotel.moderator.email);
    world.hotels[hotel.name] = {
      id: mod.providerId!,
      moderator: hotel.moderator.email,
    };
  }
  world.users = plan.users.map((user) => user.email);

  const col = (name: string) => t.connection.collection(name);

  const flightExpiry = t.moduleRef.get(FlightHoldExpiryJob, { strict: false });
  const hotelExpiry = t.moduleRef.get(HotelHoldExpiryJob, { strict: false });
  const flightCompletion = t.moduleRef.get(FlightCompletionJob, {
    strict: false,
  });
  const hotelCompletion = t.moduleRef.get(HotelStayCompletionJob, {
    strict: false,
  });
  const postCleanup = t.moduleRef.get(PostImageCleanupJob, { strict: false });
  const flights = t.moduleRef.get(FlightsService, { strict: false });
  const fxRates = t.moduleRef.get(FxRatesService, { strict: false });

  const webhook = (event: object) =>
    http()
      .post('/api/payments/webhook')
      .set('stripe-signature', FAKE_STRIPE_SIGNATURE)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));

  return {
    t,
    stripe,
    fx,
    world,
    baseUrl,
    unhandled,
    as,
    guest: () => actor('', { id: '', email: '', role: 'guest' }),
    newUser,
    col,
    jobs: {
      flightExpiry: (now = new Date()) => flightExpiry.expireDueHolds(now),
      hotelExpiry: (now = new Date()) => hotelExpiry.expireDueHolds(now),
      flightCompletion: (now = new Date()) =>
        flightCompletion.completeDepartedBookings(now),
      hotelCompletion: (now = new Date()) =>
        hotelCompletion.completeDueStays(now),
      postImageCleanup: () => postCleanup.deletePending(),
      markDeparted: (now = new Date()) => flights.markFlightsDeparted(now),
      fxRefresh: () => fxRates.refresh(),
    },
    payWebhook: (paymentIntentId, type = 'payment_intent.succeeded', eventId) =>
      webhook({
        id: eventId ?? nextEventId(),
        type,
        paymentIntent: { id: paymentIntentId, metadata: {} },
      }),
    refundWebhook: (stripeRefundId, status, ourRefundId, eventId) =>
      webhook({
        id: eventId ?? nextEventId(),
        type: status === 'failed' ? 'refund.failed' : 'refund.updated',
        refund: {
          id: stripeRefundId,
          status,
          metadata: { refundId: ourRefundId },
        },
      }),
    invariants: (options) => checkInvariants(col, options),
    close: async () => {
      process.off('unhandledRejection', onUnhandled);
      await t.close();
    },
  };
}

// -------------------------------------------------------------- invariants

const LIFECYCLE = [
  'pending_payment',
  'confirmed',
  'completed',
  'expired',
  'cancelled',
];

/**
 * The global invariants (data model §4, GEN-11, PAY-03, PAY-04). Returns one
 * line per broken one; empty means everything holds.
 */
export async function checkInvariants(
  col: (name: string) => ReturnType<Connection['collection']>,
  options: { expiryRanAt?: Date } = {},
): Promise<string[]> {
  const broken: string[] = [];
  const flights = await col('flights')
    .find({}, { projection: { cabins: 1, status: 1 } })
    .toArray();
  const flightBookings = await col('flight_bookings').find({}).toArray();
  const reservations = await col('hotel_reservations').find({}).toArray();
  const payments = await col('payments').find({}).toArray();
  const refunds = await col('refunds').find({}).toArray();

  // §4.1 every cabin: total = available + held + booked, none negative.
  const held = new Map<string, number>();
  const booked = new Map<string, number>();
  for (const booking of flightBookings) {
    for (const segment of booking.segments ?? []) {
      const key = `${String(segment.flightId)}/${String(segment.cabinId)}`;
      if (booking.status === 'pending_payment') {
        held.set(key, (held.get(key) ?? 0) + booking.seatCount);
      }
      if (booking.status === 'confirmed' || booking.status === 'completed') {
        booked.set(key, (booked.get(key) ?? 0) + booking.seatCount);
      }
    }
  }
  for (const flight of flights) {
    for (const cabin of flight.cabins ?? []) {
      const key = `${String(flight._id)}/${String(cabin._id)}`;
      const sum = cabin.availableSeats + cabin.heldSeats + cabin.bookedSeats;
      if (cabin.totalSeats !== sum) {
        broken.push(
          `§4.1 cabin ${key}: total ${cabin.totalSeats} != available ${cabin.availableSeats} + held ${cabin.heldSeats} + booked ${cabin.bookedSeats}`,
        );
      }
      for (const field of ['availableSeats', 'heldSeats', 'bookedSeats']) {
        if (cabin[field] < 0) broken.push(`§4.1 cabin ${key}: ${field} < 0`);
      }
      // The seat ledger: held/booked counters match the bookings that own them.
      if ((held.get(key) ?? 0) !== cabin.heldSeats) {
        broken.push(
          `§4.1 cabin ${key}: heldSeats ${cabin.heldSeats} but pending bookings hold ${held.get(key) ?? 0}`,
        );
      }
      if ((booked.get(key) ?? 0) !== cabin.bookedSeats) {
        broken.push(
          `§4.1 cabin ${key}: bookedSeats ${cabin.bookedSeats} but confirmed/completed bookings hold ${booked.get(key) ?? 0}`,
        );
      }
    }
  }

  // §4.2 at most one reservation or block per { roomId, date }.
  const duplicates = await col('room_nights')
    .aggregate([
      { $group: { _id: { roomId: '$roomId', date: '$date' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  for (const dup of duplicates) {
    broken.push(
      `§4.2 room night ${JSON.stringify(dup._id)} held ${dup.n} times`,
    );
  }
  // Every pending/confirmed reservation has all its nights; no other has any.
  const nightsByReservation = new Map<string, number>();
  for (const night of await col('room_nights')
    .aggregate([
      { $match: { kind: 'reservation' } },
      { $group: { _id: '$reservationId', n: { $sum: 1 } } },
    ])
    .toArray()) {
    nightsByReservation.set(String(night._id), night.n);
  }
  for (const reservation of reservations) {
    const id = String(reservation._id);
    const nights = nightsByReservation.get(id) ?? 0;
    const active =
      reservation.status === 'pending_payment' ||
      reservation.status === 'confirmed';
    const expected = active
      ? reservation.nights * (reservation.rooms?.length ?? 0)
      : null;
    if (expected !== null && nights !== expected) {
      broken.push(
        `§4.2 reservation ${id} (${reservation.status}) has ${nights} nights, expected ${expected}`,
      );
    }
    if (
      (reservation.status === 'expired' ||
        reservation.status === 'cancelled') &&
      nights > 0
    ) {
      broken.push(
        `§4.2 reservation ${id} (${reservation.status}) still holds ${nights} nights`,
      );
    }
  }

  // GEN-11 lifecycle states; no confirmed booking without a succeeded payment.
  const paymentOf = new Map<string, typeof payments>();
  for (const payment of payments) {
    const key = `${payment.bookingType}/${String(payment.bookingId)}`;
    paymentOf.set(key, [...(paymentOf.get(key) ?? []), payment]);
  }
  const refundOf = new Map<string, typeof refunds>();
  for (const refund of refunds) {
    const key = `${refund.bookingType}/${String(refund.bookingId)}`;
    refundOf.set(key, [...(refundOf.get(key) ?? []), refund]);
  }
  const all = [
    ...flightBookings.map((b) => ({
      type: 'flight',
      doc: b,
      currency: b.pricing?.currency,
    })),
    ...reservations.map((r) => ({
      type: 'hotel',
      doc: r,
      currency: r.currency,
    })),
  ];
  for (const { type, doc, currency } of all) {
    const key = `${type}/${String(doc._id)}`;
    if (!LIFECYCLE.includes(doc.status)) {
      broken.push(`GEN-11 ${key}: unknown status ${doc.status}`);
    }
    const paid = (paymentOf.get(key) ?? []).some(
      (p) => p.status === 'succeeded',
    );
    if (
      (doc.status === 'confirmed' ||
        doc.status === 'completed' ||
        doc.status === 'cancelled') &&
      !paid
    ) {
      broken.push(`GEN-11 ${key}: ${doc.status} without a succeeded payment`);
    }
    if (
      options.expiryRanAt &&
      doc.status === 'pending_payment' &&
      doc.holdExpiresAt <= options.expiryRanAt
    ) {
      broken.push(
        `GEN-11 ${key}: still pending_payment after the expiry job, hold ended ${doc.holdExpiresAt.toISOString()}`,
      );
    }
    if (currency !== PLATFORM_CURRENCY) {
      broken.push(`PAY-04 ${key}: currency ${currency}`);
    }
    if (
      (doc.status === 'confirmed' || doc.status === 'completed') &&
      !doc.reference
    ) {
      broken.push(`§8 ${key}: ${doc.status} without a reference`);
    }
  }

  // Payments: at most one per booking. Refunds: at most one, amount ≤ paid.
  for (const [key, list] of paymentOf) {
    if (list.length > 1) broken.push(`PAY-01 ${key}: ${list.length} payments`);
    for (const p of list) {
      if (p.currency !== PLATFORM_CURRENCY) {
        broken.push(`PAY-04 payment ${String(p._id)}: currency ${p.currency}`);
      }
    }
  }
  for (const [key, list] of refundOf) {
    if (list.length > 1) broken.push(`PAY-03 ${key}: ${list.length} refunds`);
    const paidAmount = Math.max(
      0,
      ...(paymentOf.get(key) ?? [])
        .filter((p) => p.status === 'succeeded')
        .map((p) => p.amountMinor as number),
    );
    for (const r of list) {
      if (r.amountMinor > paidAmount) {
        broken.push(
          `PAY-03 ${key}: refund ${r.amountMinor} > paid ${paidAmount}`,
        );
      }
      if (r.currency !== PLATFORM_CURRENCY) {
        broken.push(`PAY-04 refund ${String(r._id)}: currency ${r.currency}`);
      }
    }
  }
  return broken;
}
