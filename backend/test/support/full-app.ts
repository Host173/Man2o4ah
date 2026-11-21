import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { expect } from 'vitest';
import { FakeStripeGateway, FAKE_STRIPE_SIGNATURE } from '../fakes/index.js';
import { AccountsSeedModule } from '../../src/modules/accounts/seed/accounts-seed.module.js';
import { AdminSeedService } from '../../src/modules/accounts/seed/admin-seed.service.js';
import { AdminModule } from '../../src/modules/admin/admin.module.js';
import { AuditModule } from '../../src/modules/audit/audit.module.js';
import { BlogModule } from '../../src/modules/blog/blog.module.js';
import { FlightBookingsModule } from '../../src/modules/flight-bookings/flight-bookings.module.js';
import { FlightCompletionJob } from '../../src/modules/flight-bookings/flight-completion.job.js';
import { FlightHoldExpiryJob } from '../../src/modules/flight-bookings/flight-hold-expiry.job.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from '../../src/modules/flight-bookings/schemas/flight-booking.schema.js';
import { FlightsModule } from '../../src/modules/flights/flights.module.js';
import { FlightsService } from '../../src/modules/flights/flights.service.js';
import { Flight } from '../../src/modules/flights/schemas/flight.schema.js';
import { FX_RATES_CLIENT } from '../../src/modules/fx/fx-rates.client.js';
import type { FxRatesClient } from '../../src/modules/fx/fx-rates.client.js';
import { FxModule } from '../../src/modules/fx/fx.module.js';
import { HotelBookingsModule } from '../../src/modules/hotel-bookings/hotel-bookings.module.js';
import { HotelHoldExpiryJob } from '../../src/modules/hotel-bookings/hotel-hold-expiry.job.js';
import { HotelStayCompletionJob } from '../../src/modules/hotel-bookings/hotel-stay-completion.job.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from '../../src/modules/hotel-bookings/schemas/hotel-reservation.schema.js';
import { HotelsModule } from '../../src/modules/hotels/hotels.module.js';
import { RoomNight } from '../../src/modules/hotels/schemas/room-night.schema.js';
import { ItinerariesModule } from '../../src/modules/itineraries/itineraries.module.js';
import { ModerationModule } from '../../src/modules/moderation/moderation.module.js';
import { NotificationsModule } from '../../src/modules/notifications/notifications.module.js';
import { PaymentsModule } from '../../src/modules/payments/payments.module.js';
import { Payment } from '../../src/modules/payments/schemas/payment.schema.js';
import { Refund } from '../../src/modules/payments/schemas/refund.schema.js';
import { STRIPE_GATEWAY } from '../../src/modules/payments/stripe/stripe-gateway.js';
import type { GatewayRefundStatus } from '../../src/modules/payments/stripe/stripe-gateway.js';
import { ReferenceDataModule } from '../../src/modules/reference-data/reference-data.module.js';
import { ReferenceDataSeedService } from '../../src/modules/reference-data/seed/reference-data-seed.service.js';
import { StorageModule } from '../../src/modules/storage/storage.module.js';
import { createDemoApi } from '../../src/seed/demo/demo-api.js';
import type { DemoApi } from '../../src/seed/demo/demo-api.js';
import { buildDemoPlan } from '../../src/seed/demo/demo-plan.js';
import type { DemoPlan } from '../../src/seed/demo/demo-plan.js';
import { runDemoSeed } from '../../src/seed/demo/demo-seed.js';
import { createTestApp } from './test-app.js';
import type { TestApp } from './test-app.js';

export const DEMO_PASSWORD = 'Demo12345';
export const ADMIN_ACCOUNT = {
  email: 'admin@example.com',
  password: 'Admin12345',
} as const;

/** The demo accounts of PLT-08 (`demo-plan.ts`). */
export const DEMO_ACCOUNTS = {
  sara: 'sara@example.com',
  omar: 'omar@example.com',
  lina: 'lina@example.com',
  nileAirModerator: 'nile.mod@example.com',
  gulfWingsModerator: 'gulf.mod@example.com',
  euroConnectModerator: 'euro.mod@example.com',
  nileViewModerator: 'nileview.mod@example.com',
  marinaModerator: 'marina.mod@example.com',
  thamesModerator: 'thames.mod@example.com',
  seineModerator: 'seine.mod@example.com',
} as const;

/** Timeout for a journey file's `describe`: the demo seed and bcrypt logins are slow. */
export const JOURNEY_TIMEOUT = 120_000;

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Call = (path: string) => request.Test;

/** One logged-in person: every call sends their cookies. Paths start with `/api`. */
export interface Actor {
  email: string;
  /** `access_token=…; refresh_token=…`, for tests that replay cookies. */
  cookie: string;
  get: Call;
  post: Call;
  put: Call;
  patch: Call;
  delete: Call;
}

export interface Jobs {
  /** FlightHoldExpiryJob.expireDueHolds */
  expireFlightHolds: (now: Date) => Promise<number>;
  /** HotelHoldExpiryJob.expireDueHolds */
  expireHotelHolds: (now: Date) => Promise<number>;
  /** FlightCompletionJob.completeDepartedBookings */
  completeFlights: (now: Date) => Promise<number>;
  /** HotelStayCompletionJob.completeDueStays */
  completeHotelStays: (now: Date) => Promise<number>;
  /** FlightsService.markFlightsDeparted */
  markFlightsDeparted: (now: Date) => Promise<number>;
}

export interface Webhook {
  paymentSucceeded: (paymentIntentId: string) => request.Test;
  paymentFailed: (paymentIntentId: string) => request.Test;
  refund: (
    stripeRefundId: string,
    status: GatewayRefundStatus,
    refundId: string,
  ) => request.Test;
}

export interface FullApp {
  t: TestApp;
  /** The Stripe fake: the only payment provider. */
  gateway: FakeStripeGateway;
  /** The demo world, seeded through the API. */
  world: { plan: DemoPlan; api: DemoApi };
  /** Logs in through `POST /api/auth/login` with the demo password. */
  as: (email: string, password?: string) => Promise<Actor>;
  /** Registers a new user (ACC-01), then logs in as them. */
  newUser: (name?: string) => Promise<Actor>;
  /** The admin created as in ACC-18. */
  admin: () => Promise<Actor>;
  jobs: Jobs;
  webhook: Webhook;
  /** The global invariants of the booking and payment collections. */
  expectInvariants: () => Promise<void>;
}

/** The FX client of the journeys: fixed rates per 1 USD, no network. */
class FixedFxRatesClient implements FxRatesClient {
  fetchLatest(
    _base: string,
    currencies: string[],
  ): Promise<Record<string, number>> {
    const rates: Record<string, number> = {
      EGP: 50,
      EUR: 0.9,
      GBP: 0.8,
      AED: 3.6725,
    };
    return Promise.resolve(
      Object.fromEntries(
        currencies.flatMap((code) => {
          const rate = rates[code];
          return rate === undefined ? [] : [[code, rate]];
        }),
      ),
    );
  }
}

function cookieHeaderOf(setCookie: string[] | string | undefined): string {
  const lines = Array.isArray(setCookie)
    ? setCookie
    : setCookie === undefined
      ? []
      : [setCookie];
  return lines
    .map((line) => line.split(';')[0] ?? '')
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

const ALL_FEATURE_MODULES = [
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
];

/**
 * The whole app on the in-memory replica set: every feature module, real.
 * Only Stripe and the FX rates API are faked (`testing.md` §7). The demo
 * world of PLT-08 is seeded through HTTP, so journeys start from the data
 * graders see. Call it once per file in `beforeAll`.
 */
export async function createFullApp(): Promise<FullApp> {
  const gateway = new FakeStripeGateway();
  const t = await createTestApp({
    imports: ALL_FEATURE_MODULES,
    override: (builder) =>
      builder
        .overrideProvider(STRIPE_GATEWAY)
        .useValue(gateway)
        .overrideProvider(FX_RATES_CLIENT)
        .useValue(new FixedFxRatesClient()),
  });

  await t.moduleRef.get(ReferenceDataSeedService).run();
  await t.moduleRef
    .get(AdminSeedService, { strict: false })
    .run({ email: ADMIN_ACCOUNT.email, password: ADMIN_ACCOUNT.password });
  const rateDate = new Date();
  rateDate.setUTCHours(0, 0, 0, 0);
  await t.connection.collection('exchange_rates').insertOne({
    rateDate,
    base: 'USD',
    rates: { USD: 1, EGP: 50, EUR: 0.9, GBP: 0.8, AED: 3.6725 },
    fetchedAt: new Date(),
    source: 'e2e',
  });

  await t.app.listen(0, '127.0.0.1');
  const { port } = t.app.getHttpServer().address() as AddressInfo;
  const api = createDemoApi(`http://127.0.0.1:${port}/api`);
  const plan = buildDemoPlan({
    password: DEMO_PASSWORD,
    adminEmail: ADMIN_ACCOUNT.email,
    adminPassword: ADMIN_ACCOUNT.password,
    today: new Date().toISOString().slice(0, 10),
  });
  await runDemoSeed(api, plan, () => undefined);

  function actorFor(email: string, cookie: string): Actor {
    const call =
      (verb: Verb): Call =>
      (path) =>
        request(t.app.getHttpServer())[verb](path).set('Cookie', cookie);
    return {
      email,
      cookie,
      get: call('get'),
      post: call('post'),
      put: call('put'),
      patch: call('patch'),
      delete: call('delete'),
    };
  }

  async function as(email: string, password = DEMO_PASSWORD): Promise<Actor> {
    const res = await t
      .http()
      .post('/api/auth/login')
      .send({ email, password });
    if (res.status !== 200) {
      throw new Error(`Login as ${email} answered ${res.status}`);
    }
    return actorFor(email, cookieHeaderOf(res.headers['set-cookie']));
  }

  async function newUser(name = 'Journey User'): Promise<Actor> {
    const email = `journey.${randomUUID()}@example.com`;
    await t
      .http()
      .post('/api/auth/register')
      .send({ name, email, password: DEMO_PASSWORD, acceptTerms: true })
      .expect(201);
    return as(email);
  }

  const flightHoldExpiry = t.moduleRef.get(FlightHoldExpiryJob, {
    strict: false,
  });
  const hotelHoldExpiry = t.moduleRef.get(HotelHoldExpiryJob, {
    strict: false,
  });
  const flightCompletion = t.moduleRef.get(FlightCompletionJob, {
    strict: false,
  });
  const hotelStayCompletion = t.moduleRef.get(HotelStayCompletionJob, {
    strict: false,
  });
  const flights = t.moduleRef.get(FlightsService, { strict: false });
  const jobs: Jobs = {
    expireFlightHolds: (now) => flightHoldExpiry.expireDueHolds(now),
    expireHotelHolds: (now) => hotelHoldExpiry.expireDueHolds(now),
    completeFlights: (now) => flightCompletion.completeDepartedBookings(now),
    completeHotelStays: (now) => hotelStayCompletion.completeDueStays(now),
    markFlightsDeparted: (now) => flights.markFlightsDeparted(now),
  };

  let eventCounter = 0;
  function post(event: Record<string, unknown>): request.Test {
    eventCounter += 1;
    return t
      .http()
      .post('/api/payments/webhook')
      .set('stripe-signature', FAKE_STRIPE_SIGNATURE)
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          id: `evt_e2e_${eventCounter}_${randomUUID()}`,
          ...event,
        }),
      );
  }
  const webhook: Webhook = {
    paymentSucceeded: (paymentIntentId) =>
      post({
        type: 'payment_intent.succeeded',
        paymentIntent: { id: paymentIntentId, metadata: {} },
      }),
    paymentFailed: (paymentIntentId) =>
      post({
        type: 'payment_intent.payment_failed',
        paymentIntent: { id: paymentIntentId, metadata: {} },
      }),
    refund: (stripeRefundId, status, refundId) =>
      post({
        type: status === 'failed' ? 'refund.failed' : 'refund.updated',
        refund: { id: stripeRefundId, status, metadata: { refundId } },
      }),
  };

  const model = <T>(cls: { name: string }) =>
    t.moduleRef.get<Model<T>>(getModelToken(cls.name), { strict: false });

  async function expectInvariants(): Promise<void> {
    const flightDocs = await model<Flight>(Flight).find().lean();
    const flightBookings = await model<FlightBooking>(FlightBooking)
      .find()
      .lean();
    const heldByCabin = new Map<string, number>();
    const bookedByCabin = new Map<string, number>();
    for (const booking of flightBookings) {
      const target =
        booking.status === FlightBookingStatus.PENDING_PAYMENT
          ? heldByCabin
          : booking.status === FlightBookingStatus.CONFIRMED ||
              booking.status === FlightBookingStatus.COMPLETED
            ? bookedByCabin
            : undefined;
      if (!target) continue;
      for (const segment of booking.segments) {
        const key = segment.cabinId.toString();
        target.set(key, (target.get(key) ?? 0) + booking.seatCount);
      }
    }
    for (const flight of flightDocs) {
      for (const cabin of flight.cabins) {
        const where = `${flight.flightNumber} ${cabin.cabinClass}`;
        expect(
          cabin.availableSeats + cabin.heldSeats + cabin.bookedSeats,
          `${where}: total = available + held + booked`,
        ).toBe(cabin.totalSeats);
        const key = String((cabin as { _id?: unknown })._id);
        expect(cabin.heldSeats, `${where}: held seats`).toBe(
          heldByCabin.get(key) ?? 0,
        );
        expect(cabin.bookedSeats, `${where}: booked seats`).toBe(
          bookedByCabin.get(key) ?? 0,
        );
      }
    }

    const reservations = await model<HotelReservation>(HotelReservation)
      .find()
      .lean();
    const liveReservations = new Set(
      reservations
        .filter(
          (reservation) =>
            reservation.status !== HotelReservationStatus.EXPIRED &&
            reservation.status !== HotelReservationStatus.CANCELLED,
        )
        .map((reservation) => String((reservation as { _id?: unknown })._id)),
    );
    const roomNights = await model<RoomNight>(RoomNight).find().lean();
    const seen = new Set<string>();
    for (const night of roomNights) {
      const key = `${night.roomId.toString()}@${night.date.toISOString()}`;
      expect(seen.has(key), `room night ${key} is used once`).toBe(false);
      seen.add(key);
      if (night.reservationId) {
        expect(
          liveReservations.has(night.reservationId.toString()),
          `room night ${key} belongs to a live reservation`,
        ).toBe(true);
      }
    }

    const payments = await model<Payment>(Payment).find().lean();
    const paymentKeys = payments.map(
      (payment) => `${payment.bookingType}:${payment.bookingId.toString()}`,
    );
    expect(new Set(paymentKeys).size, 'one payment per booking').toBe(
      paymentKeys.length,
    );
    const refunds = await model<Refund>(Refund).find().lean();
    const refundKeys = refunds.map(
      (refund) => `${refund.bookingType}:${refund.bookingId.toString()}`,
    );
    expect(new Set(refundKeys).size, 'at most one refund per booking').toBe(
      refundKeys.length,
    );

    // A reference exists from confirmation on; a cancelled booking may have
    // been confirmed first or not.
    for (const booking of flightBookings) {
      if (booking.status === FlightBookingStatus.CANCELLED) continue;
      const confirmed =
        booking.status === FlightBookingStatus.CONFIRMED ||
        booking.status === FlightBookingStatus.COMPLETED;
      expect(
        booking.reference !== undefined,
        `flight booking ${booking.status} and its reference`,
      ).toBe(confirmed);
    }
  }

  return {
    t,
    gateway,
    world: { plan, api },
    as,
    newUser,
    admin: () => as(ADMIN_ACCOUNT.email, ADMIN_ACCOUNT.password),
    jobs,
    webhook,
    expectInvariants,
  };
}
