import { randomUUID } from 'node:crypto';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Types } from 'mongoose';
import request from 'supertest';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../support/full-app.js';
import type { Actor } from '../support/full-app.js';
import { imageBytes } from '../support/image-fixtures.js';
import { CATALOG } from './requirements-catalog.js';
import { createAuditApp, routeMeta } from './support/audit-app.js';
import type { AuditApp, RouteMeta } from './support/audit-app.js';
import { writeOut } from './support/results.js';
import {
  all,
  arr,
  cookieOf,
  get,
  idOf,
  isRecord,
  items,
  matches,
  num,
  resolve,
  setCookies,
  str,
} from './support/smoke-kit.js';
import type {
  Method,
  Probe,
  Res,
  Row,
  Upload,
  Who,
} from './support/smoke-kit.js';

const DAY_MS = 86_400_000;
const NONE_ID = '6553a1f0c2b4e8a9d0f1a8ff';
const CURRENCY = 'USD';
const TEMP_PASSWORD = 'Temp12345x';
const AIRLINE_TIERS = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 1, refundPercent: 10 },
];
const HOTEL_TIERS = [
  { daysBefore: 14, refundPercent: 100 },
  { daysBefore: 3, refundPercent: 50 },
  { daysBefore: 1, refundPercent: 0 },
];
const TAG = `audit${Date.now().toString(36)}`;

const ymd = (days: number) =>
  new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
const png = (field = 'file'): Upload => ({
  field,
  data: imageBytes('png'),
  filename: 'audit.png',
  contentType: 'image/png',
});
const adult = (n: number, bags = 0) => ({
  type: 'adult',
  fullName: `Audit Traveller ${n}`,
  dateOfBirth: '1990-01-01',
  documentNumber: `A${1000000 + n}`,
  extraBagCount: bags,
  ...(bags > 0 ? { extraBagWeightKg: 20 } : {}),
});
const clock = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
const has = (body: unknown, ...keys: string[]) =>
  keys.filter((k) => get(body, k) === undefined || get(body, k) === null);
const listHas = (body: unknown, id: string) =>
  items(body).some((row) => idOf(row) === id);

describe('TST-02 endpoint smoke', () => {
  let app: AuditApp;
  let doc: OpenAPIObject;
  let meta: Map<string, RouteMeta>;
  const rows: Row[] = [];
  /** World ids; `stepOf` names the step that should have set a missing key. */
  const W: Record<string, string> = {};
  const stepOf: Record<string, string> = {};
  const actors: Partial<Record<Who, Actor>> = {};
  const extra: Record<string, Actor> = {};

  function need(key: string): string {
    const value = W[key];
    if (value === undefined)
      throw new Error(`world step ${stepOf[key] ?? key} failed`);
    return value;
  }
  function actor(key: string): Actor {
    const found = extra[key] ?? actors[key as Who];
    if (!found) throw new Error(`world step ${stepOf[key] ?? key} failed`);
    return found;
  }

  async function send(
    cookie: string | undefined,
    method: Method,
    path: string,
    body?: unknown,
    file?: Upload,
  ): Promise<Res> {
    const verb = method.toLowerCase() as
      'get' | 'post' | 'put' | 'patch' | 'delete';
    let req = request(app.t.app.getHttpServer())[verb](path);
    if (cookie) req = req.set('Cookie', cookie);
    if (file) {
      req = req.attach(file.field, file.data, {
        filename: file.filename,
        contentType: file.contentType,
      });
    } else if (body !== undefined) {
      req = req.send(body as object);
    }
    const res = await req;
    return {
      status: res.status,
      body: res.body as unknown,
      headers: res.headers as Res['headers'],
    };
  }
  const as = (key: string, method: Method, path: string, body?: unknown) =>
    send(key === 'guest' ? undefined : actor(key).cookie, method, path, body);
  const login = (email: string, password: string) =>
    send(undefined, 'POST', '/api/auth/login', { email, password });

  async function poll(
    fn: () => Promise<boolean>,
    ms = 10_000,
  ): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  /** A world step: its failure is a failed row, and the run goes on. */
  async function step(
    name: string,
    keys: string[],
    fn: () => Promise<void>,
  ): Promise<void> {
    for (const key of keys) stepOf[key] = name;
    try {
      await fn();
    } catch (error) {
      rows.push({
        requirement: 'WORLD',
        probe: name,
        method: '-',
        path: '-',
        as: '-',
        expected: 0,
        got: null,
        code: null,
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      });
    }
  }
  async function expectOk(
    res: Promise<Res>,
    what: string,
    ok = [200, 201, 204],
  ): Promise<Res> {
    const r = await res;
    if (!ok.includes(r.status))
      throw new Error(
        `${what} answered ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`,
      );
    return r;
  }

  /** Flight hold of `count` adults on W.flightId, optionally accepted and paid. */
  async function flightHold(who: string, accept: boolean): Promise<string> {
    const res = await expectOk(
      as(who, 'POST', '/api/flight-bookings/hold', {
        tripType: 'one_way',
        segments: [{ flightId: need('flightId'), cabinId: need('cabinId') }],
        passengers: [adult(1)],
      }),
      'flight hold',
    );
    const id = str(get(res.body, 'bookingId')) ?? '';
    if (accept)
      await expectOk(
        as(who, 'POST', `/api/bookings/flight/${id}/accept-policies`, {
          accepted: true,
        }),
        'accept policies',
      );
    return id;
  }
  async function payAndConfirm(
    who: string,
    type: 'flight' | 'hotel',
    id: string,
  ): Promise<{ paymentId: string }> {
    const pay = await expectOk(
      as(who, 'POST', '/api/payments', { bookingType: type, bookingId: id }),
      'payment',
    );
    const intent = (str(get(pay.body, 'clientSecret')) ?? '').replace(
      /_secret$/,
      '',
    );
    const hook = await app.webhook.paymentSucceeded(intent);
    if (hook.status !== 200) throw new Error(`webhook answered ${hook.status}`);
    const path =
      type === 'flight'
        ? `/api/flight-bookings/${id}`
        : `/api/hotel-bookings/${id}`;
    const ok = await poll(
      async () =>
        str(get((await as(who, 'GET', path)).body, 'status')) === 'confirmed',
    );
    if (!ok) throw new Error(`${type} booking ${id} never became confirmed`);
    return { paymentId: str(get(pay.body, 'paymentId')) ?? '' };
  }
  async function hotelHold(
    who: string,
    roomId: string,
    checkIn: string,
    checkOut: string,
    accept: boolean,
  ): Promise<string> {
    const res = await expectOk(
      as(who, 'POST', '/api/hotel-bookings', {
        hotelId: need('hotelId'),
        checkInDate: checkIn,
        checkOutDate: checkOut,
        rooms: [{ roomId, adults: 2, childAges: [] }],
      }),
      'hotel hold',
    );
    const id = str(get(res.body, 'reservationId')) ?? '';
    if (accept)
      await expectOk(
        as(who, 'POST', `/api/bookings/hotel/${id}/accept-policies`, {
          accepted: true,
        }),
        'accept hotel policies',
      );
    return id;
  }
  async function newActor(key: string): Promise<void> {
    const a = await app.newUser(`Audit ${key}`);
    extra[key] = a;
    W[`${key}Id`] = idOf((await as(key, 'GET', '/api/auth/me')).body) ?? '';
  }

  beforeAll(async () => {
    app = await createAuditApp();
    doc = app.openApi();
    meta = routeMeta(app);

    await step(
      'actors',
      ['user', 'otherUser', 'admin', 'airlineMod', 'hotelMod'],
      async () => {
        actors.user = await app.newUser('Audit User');
        actors.otherUser = await app.newUser('Audit Other');
        actors.admin = await app.admin();
        actors.airlineMod = await app.as(DEMO_ACCOUNTS.nileAirModerator);
        actors.hotelMod = await app.as(DEMO_ACCOUNTS.nileViewModerator);
      },
    );
    await step(
      'who am I',
      ['userId', 'airlineId', 'hotelId', 'roles'],
      async () => {
        for (const who of [
          'user',
          'otherUser',
          'admin',
          'airlineMod',
          'hotelMod',
        ] as const) {
          const me = (await as(who, 'GET', '/api/auth/me')).body;
          W[`${who}Id`] = idOf(me) ?? '';
          W[`${who}Role`] = str(get(me, 'role')) ?? '';
        }
        W.airlineId =
          str(
            get(
              (await as('airlineMod', 'GET', '/api/auth/me')).body,
              'moderatorOf.providerId',
            ),
          ) ?? '';
        W.hotelId =
          str(
            get(
              (await as('hotelMod', 'GET', '/api/auth/me')).body,
              'moderatorOf.providerId',
            ),
          ) ?? '';
        W.roles = 'ok';
      },
    );
    await step(
      'throwaway users',
      ['lockUser', 'suspUser', 'resetUser', 'pwUser', 'delUser', 'outUser'],
      async () => {
        for (const key of [
          'lockUser',
          'suspUser',
          'resetUser',
          'pwUser',
          'delUser',
          'outUser',
        ]) {
          await newActor(key);
          W[key] = extra[key]?.email ?? '';
        }
      },
    );
    await step(
      'flight search (Nile Air CAI-DXB)',
      ['flightId', 'cabinId'],
      async () => {
        const res = await expectOk(
          as(
            'user',
            'GET',
            `/api/flights/search?from=CAI&to=DXB&date=${ymd(4)}&adults=1&limit=50`,
          ),
          'flight search',
        );
        const item = items(res.body).find((i) =>
          str(get(i, 'flight.flightNumber'))?.startsWith('NA'),
        );
        const cabin = arr(get(item, 'matchingCabins')).find(
          (c) => get(c, 'cabinClass') === 'economy',
        );
        W.flightId = idOf(get(item, 'flight')) ?? '';
        W.cabinId = idOf(cabin) ?? '';
        W.cabinPrice = String(num(get(cabin, 'priceMinor')) ?? 0);
        if (!W.flightId || !W.cabinId)
          throw new Error('no Nile Air economy cabin found');
      },
    );
    await step(
      'flight bookings B1 (kept), B2 (to cancel) confirmed',
      ['b1', 'b2'],
      async () => {
        const b1 = await flightHold('user', true);
        await payAndConfirm('user', 'flight', b1);
        W.b1 = b1;
        const b2 = await flightHold('user', true);
        await payAndConfirm('user', 'flight', b2);
        W.b2 = b2;
      },
    );
    await step(
      'flight holds B3 (accepted), B5 (not accepted)',
      ['b3', 'b5'],
      async () => {
        W.b3 = await flightHold('user', true);
        W.b5 = await flightHold('user', false);
      },
    );
    await step('flight B4 with a failed payment', ['b4Payment'], async () => {
      const b4 = await flightHold('user', true);
      const pay = await expectOk(
        as('user', 'POST', '/api/payments', {
          bookingType: 'flight',
          bookingId: b4,
        }),
        'payment',
      );
      const intent = (str(get(pay.body, 'clientSecret')) ?? '').replace(
        /_secret$/,
        '',
      );
      await app.webhook.paymentFailed(intent).expect(200);
      W.b4Payment = str(get(pay.body, 'paymentId')) ?? '';
    });
    await step('flight to cancel (NA 902)', ['cancelFlightId'], async () => {
      const res = await expectOk(
        as('airlineMod', 'POST', '/api/flights', {
          flightNumber: 'NA 902',
          departureAirportId: 'CAI',
          arrivalAirportId: 'DXB',
          departureLocal: `${ymd(11)}T09:00`,
          arrivalLocal: `${ymd(11)}T13:00`,
        }),
        'create flight',
      );
      W.cancelFlightId = idOf(res.body) ?? '';
    });
    await step(
      'hotel rooms (Nile View)',
      ['roomA', 'roomB', 'roomC'],
      async () => {
        const res = await expectOk(
          as(
            'guest',
            'GET',
            `/api/hotels/${need('hotelId')}/rooms/available?checkIn=${ymd(20)}&checkOut=${ymd(22)}`,
          ),
          'available rooms',
        );
        const ids = items(res.body).map((r) => idOf(r) ?? '');
        if (ids.length < 3) throw new Error(`only ${ids.length} rooms free`);
        [W.roomA, W.roomB, W.roomC] = ids;
        W.roomAPrice = String(
          num(get(items(res.body)[0], 'pricePerNightMinor')) ?? 0,
        );
      },
    );
    await step(
      'reservations R1 (kept), R2 (to cancel), R3 (completed)',
      ['r1', 'r2', 'r3'],
      async () => {
        W.r1 = await hotelHold('user', need('roomA'), ymd(20), ymd(22), true);
        await payAndConfirm('user', 'hotel', W.r1);
        W.r2 = await hotelHold('user', need('roomB'), ymd(20), ymd(22), true);
        await payAndConfirm('user', 'hotel', W.r2);
        const r3 = await hotelHold('user', need('roomC'), ymd(1), ymd(2), true);
        await payAndConfirm('user', 'hotel', r3);
        await app.jobs.completeHotelStays(new Date(Date.now() + 3 * DAY_MS));
        W.r3 = r3;
      },
    );
    await step('hotel rooms D (to delete)', ['roomD'], async () => {
      const res = await expectOk(
        as('hotelMod', 'POST', `/api/hotels/${need('hotelId')}/rooms`, {
          name: `Audit Delete ${randomUUID().slice(0, 8)}`,
          type: 'Standard',
          beds: 1,
          maxOccupancy: 2,
          pricePerNightMinor: 10000,
        }),
        'create room',
      );
      W.roomD = idOf(res.body) ?? '';
    });
    await step(
      'itinerary with days, activities, budget, transport',
      [
        'itn',
        'days',
        'act',
        'act2',
        'budget',
        'transport',
        'transport2',
        'itnDel',
      ],
      async () => {
        const it = await expectOk(
          as('user', 'POST', '/api/itineraries', {
            title: `Audit trip ${TAG}`,
            countryCodes: ['AE', 'EG'],
            startDate: ymd(4),
          }),
          'create itinerary',
        );
        W.itn = idOf(it.body) ?? '';
        const dayIds: string[] = [];
        for (const cityId of ['dubai', 'dubai', 'cairo', 'cairo']) {
          const d = await expectOk(
            as('user', 'POST', `/api/itineraries/${W.itn}/days`, { cityId }),
            'add day',
          );
          dayIds.push(idOf(d.body) ?? '');
        }
        W.days = dayIds.join(',');
        const act = async (name: string) => {
          const r = await expectOk(
            as(
              'user',
              'POST',
              `/api/itineraries/${W.itn}/days/${dayIds[0]}/activities`,
              {
                name,
                description: 'Audit activity',
                time: '09:00',
                cost: { amountMinor: 1500, currency: CURRENCY },
              },
            ),
            'add activity',
          );
          const list = arr(get(r.body, 'activities'));
          return idOf(list[list.length - 1]) ?? '';
        };
        W.act = await act('Burj Khalifa');
        W.act2 = await act('Dune bashing');
        const b = await expectOk(
          as(
            'user',
            'POST',
            `/api/itineraries/${W.itn}/days/${dayIds[0]}/budgets`,
            { category: 'food', amountMinor: 500, currency: CURRENCY },
          ),
          'add budget',
        );
        W.budget =
          idOf(b.body) ?? idOf(arr(get(b.body, 'budgetEntries')).at(-1)) ?? '';
        const tc = async () =>
          idOf(
            (
              await expectOk(
                as(
                  'user',
                  'POST',
                  `/api/itineraries/${W.itn}/transport-costs`,
                  {
                    mode: 'flight',
                    fromCityId: 'dubai',
                    toCityId: 'cairo',
                    amountMinor: 20000,
                    currency: CURRENCY,
                    dayId: dayIds[2],
                  },
                ),
                'add transport',
              )
            ).body,
          ) ?? '';
        W.transport = await tc();
        W.transport2 = await tc();
        const del = await expectOk(
          as('user', 'POST', '/api/itineraries', {
            title: 'Audit to delete',
            countryCodes: ['EG'],
            startDate: ymd(10),
          }),
          'create itinerary',
        );
        W.itnDel = idOf(del.body) ?? '';
      },
    );
    await step('activity image', ['actImage'], async () => {
      const r = await send(
        actor('user').cookie,
        'POST',
        `/api/activities/${need('act2')}/images`,
        undefined,
        png(),
      );
      if (r.status !== 201)
        throw new Error(`activity image answered ${r.status}`);
      const a = arr(get(r.body, 'activities')).find((x) => idOf(x) === W.act2);
      W.actImage = idOf(arr(get(a, 'images'))[0]) ?? '';
    });
    await step(
      'blog posts, image, comments, like',
      ['post', 'draft', 'postImage', 'comment', 'comment2', 'otherPost'],
      async () => {
        const p = await expectOk(
          as('user', 'POST', '/api/posts', {
            title: `Audit post ${TAG}`,
            body: 'Audit body text',
            tags: [TAG, 'egypt'],
            status: 'published',
          }),
          'create post',
        );
        W.post = idOf(p.body) ?? '';
        const d = await expectOk(
          as('user', 'POST', '/api/posts', {
            title: 'Audit draft',
            body: 'Draft body',
            status: 'draft',
          }),
          'draft',
        );
        W.draft = idOf(d.body) ?? '';
        const o = await expectOk(
          as('otherUser', 'POST', '/api/posts', {
            title: 'Other post',
            body: 'Other body',
            status: 'published',
          }),
          'other post',
        );
        W.otherPost = idOf(o.body) ?? '';
        const img = await send(
          actor('user').cookie,
          'POST',
          `/api/posts/${W.post}/images`,
          undefined,
          png(),
        );
        W.postImage = idOf(arr(get(img.body, 'images'))[0]) ?? '';
        const c = await expectOk(
          as('otherUser', 'POST', `/api/posts/${W.post}/comments`, {
            body: 'First comment',
          }),
          'comment',
        );
        W.comment = idOf(c.body) ?? '';
        const c2 = await expectOk(
          as('otherUser', 'POST', `/api/posts/${W.post}/comments`, {
            body: 'Second comment',
          }),
          'comment',
        );
        W.comment2 = idOf(c2.body) ?? '';
      },
    );
    await step('admin: new airline', ['newAirlineId'], async () => {
      const r = await expectOk(
        as('admin', 'POST', '/api/airlines', {
          name: `Audit Air ${TAG}`,
          code: 'QZ',
        }),
        'create airline',
      );
      W.newAirlineId = idOf(r.body) ?? '';
    });
  });
  afterAll(() => app?.t.close());

  /** The requirement probes, in the order they run. */
  function requirementProbes(): Probe[] {
    const P: Probe[] = [];
    const add = (p: Probe) => P.push(p);
    const fb = (id: string) => `/api/flight-bookings/${need(id)}`;
    const hb = (id: string) => `/api/hotel-bookings/${need(id)}`;
    const quote = (bags: number) => ({
      tripType: 'one_way',
      segments: [{ flightId: need('flightId'), cabinId: need('cabinId') }],
      passengers: [adult(1, bags)],
    });

    // ---- Accounts
    add({
      requirement: 'ACC-01',
      name: 'register',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/register',
      body: {
        name: 'Audit Reg',
        email: `reg.${randomUUID()}@example.com`,
        password: 'Passw0rd1',
        acceptTerms: true,
      },
      expect: 201,
      check: (r) =>
        all([
          !/"(password|passwordHash)"/.test(JSON.stringify(r.body)),
          'body exposes a password field',
        ]),
    });
    add({
      requirement: 'ACC-01',
      name: 'weak password rejected',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/register',
      body: {
        name: 'Weak',
        email: `weak.${randomUUID()}@example.com`,
        password: 'password',
        acceptTerms: true,
      },
      expect: 400,
    });
    add({
      requirement: 'ACC-01',
      name: 'no consent rejected',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/register',
      body: {
        name: 'NoTerms',
        email: `nt.${randomUUID()}@example.com`,
        password: 'Passw0rd1',
        acceptTerms: false,
      },
      expect: 400,
    });
    add({
      requirement: 'ACC-01',
      name: 'duplicate email rejected',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/register',
      body: () => ({
        name: 'Dup',
        email: actor('user').email,
        password: 'Passw0rd1',
        acceptTerms: true,
      }),
      expect: 409,
      check: (r) =>
        all([
          get(r.body, 'code') === ErrorCode.EmailTaken,
          'code is not EMAIL_TAKEN',
        ]),
    });
    add({
      requirement: 'ACC-04',
      name: 'login',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/login',
      body: () => ({ email: actor('user').email, password: DEMO_PASSWORD }),
      expect: 200,
      check: (r) =>
        all([
          str(get(r.body, 'role')) !== undefined ||
            str(get(r.body, 'user.role')) !== undefined,
          'no role in body',
        ]),
    });
    add({
      requirement: 'ACC-04',
      name: 'me',
      as: 'user',
      method: 'GET',
      path: '/api/auth/me',
      expect: 200,
      check: (r) =>
        all([
          get(r.body, 'email') === actor('user').email,
          'me is not the user',
        ]),
    });
    add({
      requirement: 'ACC-04',
      name: 'wrong password is generic',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/login',
      body: () => ({ email: actor('user').email, password: 'Wrong1234' }),
      expect: 401,
      check: async (r) => {
        const unknown = await login(
          `nobody.${randomUUID()}@example.com`,
          'Wrong1234',
        );
        return all(
          [
            get(r.body, 'code') === ErrorCode.InvalidCredentials,
            'code is not INVALID_CREDENTIALS',
          ],
          [
            get(unknown.body, 'message') === get(r.body, 'message'),
            'unknown email answers a different message',
          ],
        );
      },
    });
    add({
      requirement: 'ACC-05',
      name: 'lockout after 5 wrong passwords',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/login',
      expect: [401, 403, 423, 429],
      run: async () => {
        const email = need('lockUser');
        for (let i = 0; i < 5; i += 1) await login(email, 'Wrong1234');
        return login(email, DEMO_PASSWORD);
      },
      check: (r) =>
        all([
          get(r.body, 'code') === ErrorCode.AccountLocked,
          `code ${String(get(r.body, 'code'))} is not ACCOUNT_LOCKED`,
        ]),
    });
    add({
      requirement: 'ACC-06',
      name: 'refresh',
      as: 'user',
      method: 'POST',
      path: '/api/auth/refresh',
      cookie: () => actor('outUser').cookie,
      expect: [200, 204],
      check: (r) =>
        all([
          setCookies(r).some((c) => c.startsWith('access_token=')),
          'no new access_token cookie',
        ]),
    });
    add({
      requirement: 'ACC-06',
      name: 'logout clears cookies and revokes refresh',
      as: 'user',
      method: 'POST',
      path: '/api/auth/logout',
      expect: [200, 204],
      run: async () => {
        const res = await login(need('outUser'), DEMO_PASSWORD);
        const cookie = cookieOf(res);
        W.outCookie = cookie;
        return send(cookie, 'POST', '/api/auth/logout');
      },
      check: async (r) => {
        const again = await send(W.outCookie, 'POST', '/api/auth/refresh');
        return all(
          [
            setCookies(r).some((c) =>
              /^access_token=;|Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c),
            ),
            'cookies not cleared',
          ],
          [
            again.status === 401,
            `refresh after logout answered ${again.status}`,
          ],
        );
      },
    });
    add({
      requirement: 'ACC-07a',
      name: 'admin resets password',
      as: 'admin',
      method: 'POST',
      path: () => `/api/admin/users/${need('resetUserId')}/reset-password`,
      body: { temporaryPassword: TEMP_PASSWORD },
      expect: [200, 204],
      check: async () => {
        const res = await login(need('resetUser'), TEMP_PASSWORD);
        W.resetCookie = cookieOf(res);
        return all([
          res.status === 200,
          `login with the temporary password answered ${res.status}`,
        ]);
      },
    });
    add({
      requirement: 'ACC-07a',
      name: 'temporary password forces a change',
      as: 'user',
      method: 'GET',
      path: '/api/users/me',
      cookie: () => W.resetCookie ?? '',
      expect: 403,
      check: (r) =>
        all([
          get(r.body, 'code') === ErrorCode.PasswordChangeRequired,
          'code is not PASSWORD_CHANGE_REQUIRED',
        ]),
    });
    add({
      requirement: 'ACC-07a',
      name: 'change temporary password',
      as: 'user',
      method: 'PATCH',
      path: '/api/auth/change-password',
      cookie: () => W.resetCookie ?? '',
      body: { currentPassword: TEMP_PASSWORD, newPassword: 'NewPass123' },
      expect: [200, 204],
    });
    add({
      requirement: 'ACC-08',
      name: 'change password',
      as: 'user',
      method: 'PATCH',
      path: '/api/auth/change-password',
      cookie: () => actor('pwUser').cookie,
      body: { currentPassword: DEMO_PASSWORD, newPassword: 'Changed123' },
      expect: [200, 204],
      check: async () => {
        const res = await login(need('pwUser'), 'Changed123');
        return all([
          res.status === 200,
          `login with the new password answered ${res.status}`,
        ]);
      },
    });
    add({
      requirement: 'ACC-09',
      name: 'profile',
      as: 'user',
      method: 'GET',
      path: '/api/users/me',
      expect: 200,
      check: (r) =>
        all([
          has(r.body, 'name', 'email').length === 0,
          'profile lacks name/email',
        ]),
    });
    add({
      requirement: 'ACC-09',
      name: 'edit profile',
      as: 'user',
      method: 'PATCH',
      path: '/api/users/me',
      body: {
        name: 'Audit User Edited',
        phone: '+201001234567',
        preferredCurrency: 'EUR',
      },
      expect: 200,
      check: (r) =>
        all(
          [get(r.body, 'name') === 'Audit User Edited', 'name not saved'],
          [get(r.body, 'preferredCurrency') === 'EUR', 'currency not saved'],
        ),
    });
    add({
      requirement: 'ACC-09',
      name: 'invalid phone saves nothing',
      as: 'user',
      method: 'PATCH',
      path: '/api/users/me',
      body: { name: 'Should Not Save', phone: 'not a phone' },
      expect: 400,
    });
    add({
      requirement: 'ACC-11',
      name: 'other user reads a flight booking',
      as: 'otherUser',
      method: 'GET',
      path: () => fb('b1'),
      expect: [403, 404],
    });
    add({
      requirement: 'ACC-11',
      name: 'other user reads a reservation',
      as: 'otherUser',
      method: 'GET',
      path: () => hb('r1'),
      expect: [403, 404],
    });
    add({
      requirement: 'ACC-11',
      name: 'other user reads a private itinerary',
      as: 'otherUser',
      method: 'GET',
      path: () => `/api/itineraries/${need('itn')}`,
      expect: [403, 404],
    });
    add({
      requirement: 'ACC-12',
      name: 'deactivation needs confirm',
      as: 'user',
      method: 'DELETE',
      path: '/api/users/me',
      cookie: () => actor('delUser').cookie,
      body: {},
      expect: 400,
    });
    add({
      requirement: 'ACC-12',
      name: 'deactivate own account',
      as: 'user',
      method: 'DELETE',
      path: '/api/users/me',
      cookie: () => actor('delUser').cookie,
      body: { confirm: true },
      expect: [200, 204],
      check: async () => {
        const res = await login(need('delUser'), DEMO_PASSWORD);
        return all([res.status !== 200, 'a deactivated user can still log in']);
      },
    });
    add({
      requirement: 'ACC-12',
      name: 'blocked with upcoming confirmed bookings',
      as: 'user',
      method: 'DELETE',
      path: '/api/users/me',
      body: { confirm: true },
      expect: 409,
      check: (r) =>
        all([
          get(r.body, 'code') === ErrorCode.ActiveBookingsExist,
          'code is not ACTIVE_BOOKINGS_EXIST',
        ]),
    });
    add({
      requirement: 'ACC-13',
      name: 'create moderator',
      as: 'admin',
      method: 'POST',
      path: '/api/admin/moderators',
      body: () => ({
        name: 'Audit Moderator',
        email: `mod.${randomUUID()}@example.com`,
        role: 'airline_moderator',
        providerId: need('newAirlineId'),
        temporaryPassword: TEMP_PASSWORD,
      }),
      expect: 201,
      check: (r) => {
        W.newModId = idOf(r.body) ?? '';
        W.newModEmail = str(get(r.body, 'email')) ?? '';
        return all([
          get(r.body, 'role') === 'airline_moderator',
          'role not airline_moderator',
        ]);
      },
    });
    add({
      requirement: 'ACC-14',
      name: 'accounts list, search, filter',
      as: 'admin',
      method: 'GET',
      path: '/api/admin/accounts?q=Audit&role=user&status=active',
      expect: 200,
      check: (r) => {
        const rows = items(r.body);
        return all(
          [rows.length > 0, 'no account found'],
          [
            rows.every(
              (a) =>
                has(a, 'name', 'email', 'role', 'status', 'createdAt')
                  .length === 0,
            ),
            `an account lacks ${has(rows[0], 'name', 'email', 'role', 'status', 'createdAt').join(',')}`,
          ],
          [
            rows.every(
              (a) => get(a, 'role') === 'user' && get(a, 'status') === 'active',
            ),
            'filter not applied',
          ],
        );
      },
    });
    add({
      requirement: 'ACC-15',
      name: 'suspend moderator',
      as: 'admin',
      method: 'PATCH',
      path: () => `/api/admin/accounts/${need('newModId')}/suspend`,
      expect: [200, 204],
      check: async () => {
        const res = await login(need('newModEmail'), TEMP_PASSWORD);
        return all([
          get(res.body, 'code') === ErrorCode.AccountSuspended,
          `suspended moderator login answered ${res.status} ${String(get(res.body, 'code'))}`,
        ]);
      },
    });
    add({
      requirement: 'ACC-15',
      name: 'deactivate provider',
      as: 'admin',
      method: 'PATCH',
      path: () =>
        `/api/admin/providers/airline/${need('newAirlineId')}/deactivate`,
      expect: [200, 204],
    });
    add({
      requirement: 'ACC-15',
      name: 'reactivate provider',
      as: 'admin',
      method: 'PATCH',
      path: () =>
        `/api/admin/providers/airline/${need('newAirlineId')}/reactivate`,
      expect: [200, 204],
    });
    add({
      requirement: 'ACC-16',
      name: 'suspend user',
      as: 'admin',
      method: 'PATCH',
      path: () => `/api/admin/accounts/${need('suspUserId')}/suspend`,
      expect: [200, 204],
      check: async () => {
        const res = await login(need('suspUser'), DEMO_PASSWORD);
        return all([
          get(res.body, 'code') === ErrorCode.AccountSuspended,
          `suspended login answered ${res.status} ${String(get(res.body, 'code'))}`,
        ]);
      },
    });
    add({
      requirement: 'ACC-16',
      name: 'reactivate user',
      as: 'admin',
      method: 'PATCH',
      path: () => `/api/admin/accounts/${need('suspUserId')}/reactivate`,
      expect: [200, 204],
      check: async () => {
        const res = await login(need('suspUser'), DEMO_PASSWORD);
        return all([
          res.status === 200,
          `reactivated login answered ${res.status}`,
        ]);
      },
    });
    add({
      requirement: 'ACC-17',
      name: 'all bookings, filtered',
      as: 'admin',
      method: 'GET',
      path: `/api/admin/bookings?type=flight&status=confirmed&limit=50`,
      expect: 200,
      check: (r) => {
        const rows = items(r.body);
        return all(
          [
            rows.some((b) => idOf(b) === W.b1 || get(b, 'bookingId') === W.b1),
            'B1 not listed',
          ],
          [
            rows.every((b) => get(b, 'status') === 'confirmed'),
            'status filter not applied',
          ],
          [
            rows.every((b) => get(b, 'reference') !== undefined),
            'a row lacks a reference',
          ],
        );
      },
    });
    add({
      requirement: 'ACC-18',
      name: 'seeded admin logs in',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'admin@example.com', password: 'Admin12345' },
      expect: 200,
      check: (r) =>
        all([
          JSON.stringify(r.body).includes('"admin"'),
          'role admin not in body',
        ]),
    });
    add({
      requirement: 'ACC-18',
      name: 'no admin self-registration',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/register',
      body: {
        name: 'Sneaky',
        email: `sneaky.${randomUUID()}@example.com`,
        password: 'Passw0rd1',
        acceptTerms: true,
        role: 'admin',
      },
      expect: 400,
    });
    add({
      requirement: 'ACC-19',
      name: 'tokens only as httpOnly SameSite cookies',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/login',
      body: () => ({
        email: actor('otherUser').email,
        password: DEMO_PASSWORD,
      }),
      expect: 200,
      check: (r) => {
        const cookies = setCookies(r).filter((c) =>
          /^(access|refresh)_token=/.test(c),
        );
        return all(
          [cookies.length === 2, `${cookies.length} token cookies`],
          [
            cookies.every((c) => /HttpOnly/i.test(c) && /SameSite/i.test(c)),
            'a token cookie lacks HttpOnly/SameSite',
          ],
          [!/token/i.test(JSON.stringify(r.body)), 'body carries a token'],
        );
      },
    });
    add({
      requirement: 'ACC-19',
      name: 'me from cookie',
      as: 'user',
      method: 'GET',
      path: '/api/auth/me',
      expect: 200,
    });

    // ---- Flights
    add({
      requirement: 'FLT-01',
      name: 'airline profile',
      as: 'guest',
      method: 'GET',
      path: () => `/api/airlines/${need('airlineId')}`,
      expect: 200,
      check: (r) =>
        all([has(r.body, 'name', 'code').length === 0, 'no name/code']),
    });
    add({
      requirement: 'FLT-01',
      name: 'moderator edits airline',
      as: 'airlineMod',
      method: 'PATCH',
      path: () => `/api/airlines/${need('airlineId')}`,
      body: { name: 'Nile Air' },
      expect: 200,
      check: (r) => all([get(r.body, 'name') === 'Nile Air', 'name not saved']),
    });
    add({
      requirement: 'FLT-01',
      name: 'admin creates airline',
      as: 'admin',
      method: 'POST',
      path: '/api/airlines',
      body: { name: `Audit Two ${TAG}`, code: 'QY' },
      expect: 201,
    });
    add({
      requirement: 'FLT-02',
      name: 'airports',
      as: 'guest',
      method: 'GET',
      path: '/api/airports?limit=50',
      expect: 200,
      check: (r) => {
        const rows = items(r.body);
        const bad = rows.find(
          (a) => has(a, 'name', 'cityId', 'countryCode', 'timeZone').length > 0,
        );
        return all(
          [rows.length > 0, 'no airports'],
          [
            rows.every((a) =>
              /^[A-Z]{3}$/.test(String((a as { _id?: unknown })._id)),
            ),
            'airport _id is not a 3-letter IATA code (data-model: _id = iata_code)',
          ],
          [
            bad === undefined,
            `airport lacks ${has(bad, 'name', 'cityId', 'countryCode', 'timeZone').join(',')}`,
          ],
        );
      },
    });
    add({
      requirement: 'FLT-03',
      name: 'create flight in local time',
      as: 'airlineMod',
      method: 'POST',
      path: '/api/flights',
      body: {
        flightNumber: 'NA 901',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureLocal: `${ymd(10)}T09:00`,
        arrivalLocal: `${ymd(10)}T15:00`,
      },
      expect: 201,
      check: (r) => {
        W.newFlightId = idOf(r.body) ?? '';
        const dep = str(get(r.body, 'departureAt')) ?? '';
        return all(
          [dep.endsWith('Z'), 'departureAt not UTC'],
          [
            dep !== '' && clock(dep, 'Africa/Cairo') === '09:00',
            `departureAt ${dep} is not 09:00 Cairo`,
          ],
        );
      },
    });
    add({
      requirement: 'FLT-03',
      name: 'departure in the past rejected',
      as: 'airlineMod',
      method: 'POST',
      path: '/api/flights',
      body: {
        flightNumber: 'NA 903',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureLocal: `${ymd(-2)}T09:00`,
        arrivalLocal: `${ymd(-2)}T15:00`,
      },
      expect: 400,
    });
    add({
      requirement: 'FLT-03',
      name: 'same airports rejected',
      as: 'airlineMod',
      method: 'POST',
      path: '/api/flights',
      body: {
        flightNumber: 'NA 904',
        departureAirportId: 'CAI',
        arrivalAirportId: 'CAI',
        departureLocal: `${ymd(10)}T09:00`,
        arrivalLocal: `${ymd(10)}T15:00`,
      },
      expect: 400,
    });
    add({
      requirement: 'FLT-03',
      name: 'arrival before departure rejected',
      as: 'airlineMod',
      method: 'POST',
      path: '/api/flights',
      body: {
        flightNumber: 'NA 905',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureLocal: `${ymd(10)}T09:00`,
        arrivalLocal: `${ymd(10)}T07:00`,
      },
      expect: 400,
    });
    add({
      requirement: 'FLT-03',
      name: 'duplicate number same day rejected',
      as: 'airlineMod',
      method: 'POST',
      path: '/api/flights',
      body: {
        flightNumber: 'NA 901',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureLocal: `${ymd(10)}T18:00`,
        arrivalLocal: `${ymd(10)}T23:00`,
      },
      expect: 409,
    });
    add({
      requirement: 'FLT-04',
      name: 'add cabin',
      as: 'airlineMod',
      method: 'POST',
      path: () => `/api/flights/${need('newFlightId')}/cabins`,
      body: {
        cabinClass: 'economy',
        totalSeats: 20,
        priceMinor: 20000,
        freeBags: 1,
        maxBagWeightKg: 23,
      },
      expect: [200, 201],
      check: (r) => {
        const cabins = arr(get(r.body, 'cabins'));
        W.newCabinId = idOf(cabins[0]) ?? '';
        return all([cabins.length === 1, `${cabins.length} cabins`]);
      },
    });
    add({
      requirement: 'FLT-04',
      name: 'same class twice rejected',
      as: 'airlineMod',
      method: 'POST',
      path: () => `/api/flights/${need('newFlightId')}/cabins`,
      body: {
        cabinClass: 'economy',
        totalSeats: 10,
        priceMinor: 20000,
        freeBags: 1,
        maxBagWeightKg: 23,
      },
      expect: [400, 409],
    });
    add({
      requirement: 'FLT-04',
      name: 'zero seats rejected',
      as: 'airlineMod',
      method: 'POST',
      path: () => `/api/flights/${need('newFlightId')}/cabins`,
      body: {
        cabinClass: 'business',
        totalSeats: 0,
        priceMinor: 20000,
        freeBags: 1,
        maxBagWeightKg: 23,
      },
      expect: 400,
    });
    add({
      requirement: 'FLT-04',
      name: 'edit cabin price',
      as: 'airlineMod',
      method: 'PATCH',
      path: () =>
        `/api/flights/${need('newFlightId')}/cabins/${need('newCabinId')}`,
      body: { priceMinor: 21000 },
      expect: 200,
      check: (r) =>
        all([
          arr(get(r.body, 'cabins')).some(
            (c) => get(c, 'priceMinor') === 21000,
          ),
          'price not saved',
        ]),
    });
    add({
      requirement: 'FLT-05',
      name: 'edit times',
      as: 'airlineMod',
      method: 'PATCH',
      path: () => `/api/flights/${need('newFlightId')}`,
      body: {
        departureLocal: `${ymd(10)}T10:00`,
        arrivalLocal: `${ymd(10)}T16:00`,
      },
      expect: 200,
      check: (r) =>
        all([
          clock(
            str(get(r.body, 'departureAt')) ?? new Date(0).toISOString(),
            'Africa/Cairo',
          ) === '10:00',
          'time not saved',
        ]),
    });
    add({
      requirement: 'FLT-05',
      name: 'seats below booked rejected',
      as: 'airlineMod',
      method: 'PATCH',
      path: () => `/api/flights/${need('flightId')}/cabins/${need('cabinId')}`,
      body: { totalSeats: 1 },
      expect: [400, 409],
    });
    add({
      requirement: 'FLT-05',
      name: 'airline flights',
      as: 'airlineMod',
      method: 'GET',
      path: () => `/api/airlines/${need('airlineId')}/flights?limit=50`,
      expect: 200,
      check: (r) => all([items(r.body).length > 0, 'no flights']),
    });
    add({
      requirement: 'FLT-06',
      name: 'cancel flight',
      as: 'airlineMod',
      method: 'POST',
      path: () => `/api/flights/${need('cancelFlightId')}/cancel`,
      expect: [200, 204],
      check: async () => {
        const f = await as(
          'guest',
          'GET',
          `/api/flights/${need('cancelFlightId')}`,
        );
        return all([
          get(f.body, 'status') === 'cancelled',
          `flight status ${String(get(f.body, 'status'))}`,
        ]);
      },
    });
    add({
      requirement: 'FLT-08',
      name: 'baggage policy',
      as: 'airlineMod',
      method: 'PUT',
      path: () => `/api/airlines/${need('airlineId')}/baggage-policy`,
      body: { extraBagPriceMinor: 5000, maxExtraBagsPerPassenger: 2 },
      expect: 200,
    });
    add({
      requirement: 'FLT-08',
      name: 'zero bag price rejected',
      as: 'airlineMod',
      method: 'PUT',
      path: () => `/api/airlines/${need('airlineId')}/baggage-policy`,
      body: { extraBagPriceMinor: 0, maxExtraBagsPerPassenger: 2 },
      expect: 400,
    });
    add({
      requirement: 'FLT-09',
      name: 'cancellation tiers',
      as: 'airlineMod',
      method: 'PUT',
      path: () => `/api/airlines/${need('airlineId')}/cancellation-policy`,
      body: { tiers: AIRLINE_TIERS },
      expect: 200,
      check: (r) =>
        all([
          JSON.stringify(r.body).includes('refundPercent'),
          'tiers not echoed',
        ]),
    });
    add({
      requirement: 'FLT-09',
      name: 'duplicate threshold rejected',
      as: 'airlineMod',
      method: 'PUT',
      path: () => `/api/airlines/${need('airlineId')}/cancellation-policy`,
      body: {
        tiers: [
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 7, refundPercent: 20 },
        ],
      },
      expect: 400,
    });
    add({
      requirement: 'FLT-11',
      name: 'search one way',
      as: 'guest',
      method: 'GET',
      path: `/api/flights/search?from=CAI&to=DXB&date=${ymd(4)}&adults=1`,
      expect: 200,
      check: (r) => {
        const rows = items(r.body);
        return all(
          [rows.length > 0, 'nothing found'],
          [
            rows.every((i) => get(i, 'flight.departureLocalDate') === ymd(4)),
            'a flight on another date',
          ],
          [
            rows.every((i) => get(i, 'flight.status') === 'scheduled'),
            'a non-scheduled flight',
          ],
        );
      },
    });
    add({
      requirement: 'FLT-11',
      name: 'no flights found is empty',
      as: 'guest',
      method: 'GET',
      path: `/api/flights/search?from=JFK&to=CDG&date=${ymd(4)}&adults=1`,
      expect: 200,
      check: (r) =>
        all([
          items(r.body).length === 0,
          'found flights on a route nobody flies',
        ]),
    });
    add({
      requirement: 'FLT-12',
      name: 'round trip search',
      as: 'guest',
      method: 'GET',
      path: `/api/flights/search?from=CAI&to=LHR&date=${ymd(5)}&returnDate=${ymd(7)}&adults=1`,
      expect: 200,
      check: (r) =>
        all([
          items(get(r.body, 'outbound')).length > 0 &&
            items(get(r.body, 'inbound')).length > 0,
          'no outbound/inbound options',
        ]),
    });
    add({
      requirement: 'FLT-12',
      name: 'cabin class filter',
      as: 'guest',
      method: 'GET',
      path: `/api/flights/search?from=CAI&to=DXB&date=${ymd(4)}&adults=1&cabinClass=business`,
      expect: 200,
      check: (r) =>
        all([
          items(r.body).every((i) =>
            arr(get(i, 'matchingCabins')).every(
              (c) => get(c, 'cabinClass') === 'business',
            ),
          ),
          'a non-business cabin',
        ]),
    });
    add({
      requirement: 'FLT-12',
      name: 'infant pays 10%',
      as: 'user',
      method: 'POST',
      path: '/api/flight-bookings',
      body: () => ({
        ...quote(0),
        passengers: [
          adult(1),
          {
            type: 'infant',
            fullName: 'Audit Baby',
            dateOfBirth: ymd(-200),
            documentNumber: 'I1234567',
            extraBagCount: 0,
          },
        ],
      }),
      expect: 200,
      check: (r) => {
        const price = Number(W.cabinPrice);
        return all([
          get(r.body, 'pricing.fareTotalMinor') ===
            price + Math.round(price * 0.1),
          `fare ${String(get(r.body, 'pricing.fareTotalMinor'))} for price ${price}`,
        ]);
      },
    });
    add({
      requirement: 'FLT-12',
      name: 'infant without adult rejected',
      as: 'user',
      method: 'POST',
      path: '/api/flight-bookings',
      body: () => ({
        ...quote(0),
        passengers: [
          {
            type: 'infant',
            fullName: 'Audit Baby',
            dateOfBirth: ymd(-200),
            documentNumber: 'I1234567',
            extraBagCount: 0,
          },
        ],
      }),
      expect: 400,
    });
    add({
      requirement: 'FLT-12',
      name: 'round trip hold',
      as: 'otherUser',
      method: 'POST',
      path: '/api/flight-bookings/hold',
      body: async () => {
        const s = await as(
          'guest',
          'GET',
          `/api/flights/search?from=CAI&to=LHR&date=${ymd(5)}&returnDate=${ymd(7)}&adults=1`,
        );
        const leg = (k: string) => {
          const i = items(get(s.body, k))[0];
          return {
            flightId: idOf(get(i, 'flight')),
            cabinId: idOf(arr(get(i, 'matchingCabins'))[0]),
          };
        };
        return {
          tripType: 'round_trip',
          segments: [leg('outbound'), leg('inbound')],
          passengers: [adult(1)],
        };
      },
      expect: 201,
      check: (r) =>
        all([
          arr(get(r.body, 'segments'))
            .map((s) => get(s, 'direction'))
            .join() === 'outbound,return',
          'segments not outbound,return',
        ]),
    });
    const sorted = (xs: number[]) =>
      xs.every((x, i) => i === 0 || (xs[i - 1] ?? 0) <= x);
    const minPrice = (i: unknown) =>
      Math.min(
        ...arr(get(i, 'matchingCabins')).map(
          (c) => num(get(c, 'priceMinor')) ?? Infinity,
        ),
      );
    add({
      requirement: 'FLT-15',
      name: 'price filter and sort by price',
      as: 'guest',
      method: 'GET',
      path: `/api/flights/search?from=CAI&to=DXB&date=${ymd(4)}&adults=1&minPriceMinor=10000&maxPriceMinor=60000&sortBy=price`,
      expect: 200,
      check: (r) => {
        const prices = items(r.body).map(minPrice);
        return all(
          [prices.length > 0, 'nothing found'],
          [sorted(prices), `not sorted by price: ${prices.join(',')}`],
          [
            prices.every((p) => p >= 10000 && p <= 60000),
            'price outside range',
          ],
        );
      },
    });
    add({
      requirement: 'FLT-15',
      name: 'sort by departure',
      as: 'guest',
      method: 'GET',
      path: `/api/flights/search?from=CAI&to=DXB&date=${ymd(4)}&adults=1&sortBy=departure`,
      expect: 200,
      check: (r) => {
        const t = items(r.body).map((i) =>
          Date.parse(str(get(i, 'flight.departureAt')) ?? ''),
        );
        return all([sorted(t), 'not sorted by departure']);
      },
    });
    add({
      requirement: 'FLT-15',
      name: 'min > max rejected',
      as: 'guest',
      method: 'GET',
      path: `/api/flights/search?from=CAI&to=DXB&date=${ymd(4)}&adults=1&minPriceMinor=50000&maxPriceMinor=100`,
      expect: 400,
    });
    add({
      requirement: 'FLT-17',
      name: 'flight details',
      as: 'guest',
      method: 'GET',
      path: () => `/api/flights/${need('flightId')}`,
      expect: 200,
      check: (r) => {
        const missing = has(
          r.body,
          'airline.name',
          'flightNumber',
          'departureAt',
          'arrivalAt',
          'departureTimeZone',
          'arrivalTimeZone',
        );
        const cabins = arr(get(r.body, 'cabins'));
        return all(
          [missing.length === 0, `missing ${missing.join(',')}`],
          [
            cabins.length > 0 &&
              cabins.every(
                (c) =>
                  has(
                    c,
                    'priceMinor',
                    'availableSeats',
                    'freeBags',
                    'maxBagWeightKg',
                  ).length === 0,
              ),
            'a cabin lacks price/seats/baggage',
          ],
          [
            JSON.stringify(r.body).includes('refundPercent'),
            'no cancellation policy',
          ],
        );
      },
    });
    add({
      requirement: 'FLT-19',
      name: 'extra baggage priced',
      as: 'user',
      method: 'POST',
      path: '/api/flight-bookings',
      body: () => quote(1),
      expect: 200,
      check: (r) =>
        all([
          get(r.body, 'pricing.baggageTotalMinor') === 5000,
          `baggage ${String(get(r.body, 'pricing.baggageTotalMinor'))}`,
        ]),
    });
    add({
      requirement: 'FLT-19',
      name: 'bags over the maximum rejected',
      as: 'user',
      method: 'POST',
      path: '/api/flight-bookings',
      body: () => quote(3),
      expect: 400,
    });
    add({
      requirement: 'FLT-21',
      name: 'booking summary',
      as: 'user',
      method: 'POST',
      path: '/api/flight-bookings',
      body: () => quote(1),
      expect: 200,
      check: (r) =>
        all(
          [
            get(r.body, 'pricing.totalMinor') ===
              (num(get(r.body, 'pricing.fareTotalMinor')) ?? 0) +
                (num(get(r.body, 'pricing.baggageTotalMinor')) ?? 0),
            'total != fare + baggage',
          ],
          [
            arr(get(r.body, 'passengers')).length === 1 ||
              get(r.body, 'seatCount') === 1,
            'no passengers in summary',
          ],
        ),
    });
    add({
      requirement: 'FLT-22',
      name: 'hold seats 10 minutes',
      as: 'otherUser',
      method: 'POST',
      path: '/api/flight-bookings/hold',
      body: () => quote(0),
      expect: 201,
      check: (r) => {
        const left =
          Date.parse(str(get(r.body, 'holdExpiresAt')) ?? '') - Date.now();
        return all(
          [get(r.body, 'status') === 'pending_payment', 'not pending_payment'],
          [
            left > 8 * 60_000 && left <= 10 * 60_000 + 5000,
            `hold of ${left} ms`,
          ],
        );
      },
    });
    add({
      requirement: 'FLT-22',
      name: 'more seats than available rejected',
      as: 'otherUser',
      method: 'POST',
      path: '/api/flight-bookings/hold',
      body: () => ({
        ...quote(0),
        passengers: Array.from({ length: 9 }, (_, i) => adult(i)),
        segments: [
          { flightId: need('newFlightId'), cabinId: need('newCabinId') },
        ],
      }),
      expect: [201, 409],
      check: (r) =>
        r.status === 409
          ? all([
              get(r.body, 'code') === ErrorCode.SeatsUnavailable,
              'code not SEATS_UNAVAILABLE',
            ])
          : null,
    });
    add({
      requirement: 'FLT-23',
      name: 'confirmed with reference',
      as: 'user',
      method: 'GET',
      path: () => fb('b1'),
      expect: 200,
      check: (r) =>
        all(
          [get(r.body, 'status') === 'confirmed', 'not confirmed'],
          [
            /^[A-Z0-9]{6,}/.test(str(get(r.body, 'reference')) ?? ''),
            'no reference',
          ],
        ),
    });
    add({
      requirement: 'FLT-23',
      name: 'e-ticket PDF',
      as: 'user',
      method: 'GET',
      path: () => `${fb('b1')}/e-ticket`,
      expect: 200,
      check: (r) =>
        all([
          String(r.headers['content-type']).startsWith('application/pdf'),
          `content-type ${String(r.headers['content-type'])}`,
        ]),
    });
    add({
      requirement: 'FLT-25',
      name: 'my flight bookings grouped',
      as: 'user',
      method: 'GET',
      path: '/api/flight-bookings?group=upcoming',
      expect: 200,
      check: (r) => all([listHas(r.body, W.b1 ?? ''), 'B1 not in upcoming']),
    });
    add({
      requirement: 'FLT-25',
      name: 'details',
      as: 'user',
      method: 'GET',
      path: () => fb('b1'),
      expect: 200,
      check: (r) =>
        all([arr(get(r.body, 'passengers')).length > 0, 'no passengers']),
    });
    add({
      requirement: 'FLT-26',
      name: 'refund preview',
      as: 'user',
      method: 'GET',
      path: () => `${fb('b2')}/refund-preview`,
      expect: 200,
      check: (r) => {
        W.b2Preview = String(num(get(r.body, 'amountMinor')) ?? -1);
        return all([
          get(r.body, 'percent') === 10,
          `percent ${String(get(r.body, 'percent'))} (4 days before, tier 1d=10%)`,
        ]);
      },
    });
    add({
      requirement: 'FLT-26',
      name: 'cancel with refund',
      as: 'user',
      method: 'POST',
      path: () => `${fb('b2')}/cancel`,
      body: {},
      expect: 200,
      check: (r) => {
        W.refundId = str(get(r.body, 'refund.refundId')) ?? '';
        return all(
          [get(r.body, 'status') === 'cancelled', 'not cancelled'],
          [
            String(get(r.body, 'refund.amountMinor')) === W.b2Preview,
            'refund differs from preview',
          ],
        );
      },
    });
    add({
      requirement: 'FLT-26',
      name: 'cancel twice rejected',
      as: 'user',
      method: 'POST',
      path: () => `${fb('b2')}/cancel`,
      body: {},
      expect: 409,
    });
    add({
      requirement: 'FLT-29',
      name: 'flight bookings for moderator',
      as: 'airlineMod',
      method: 'GET',
      path: () => `/api/flights/${need('flightId')}/bookings`,
      expect: 200,
      check: (r) =>
        all([
          JSON.stringify(r.body).includes('Audit Traveller'),
          'no passenger names',
        ]),
    });
    add({
      requirement: 'FLT-29',
      name: 'passenger CSV',
      as: 'airlineMod',
      method: 'GET',
      path: () => `/api/flights/${need('flightId')}/passengers/export`,
      expect: 200,
      check: (r) =>
        all([
          String(r.headers['content-type']).startsWith('text/csv'),
          `content-type ${String(r.headers['content-type'])}`,
        ]),
    });
    add({
      requirement: 'FLT-29',
      name: "another airline's flight",
      as: 'airlineMod',
      method: 'GET',
      path: async () => {
        const s = await as(
          'guest',
          'GET',
          `/api/flights/search?from=CAI&to=DXB&date=${ymd(4)}&adults=1`,
        );
        const gw = items(s.body).find((i) =>
          str(get(i, 'flight.flightNumber'))?.startsWith('GW'),
        );
        return `/api/flights/${idOf(get(gw, 'flight')) ?? NONE_ID}/bookings`;
      },
      expect: [403, 404],
    });
    add({
      requirement: 'FLT-30',
      name: 'cancelled flight not searchable',
      as: 'guest',
      method: 'GET',
      path: `/api/flights/search?from=CAI&to=DXB&date=${ymd(11)}&adults=1&limit=50`,
      expect: 200,
      check: (r) =>
        all([
          !items(r.body).some(
            (i) => idOf(get(i, 'flight')) === W.cancelFlightId,
          ),
          'cancelled flight still in search',
        ]),
    });
    add({
      requirement: 'FLT-30',
      name: 'status on details',
      as: 'guest',
      method: 'GET',
      path: () => `/api/flights/${need('flightId')}`,
      expect: 200,
      check: (r) =>
        all([
          ['scheduled', 'cancelled', 'departed'].includes(
            String(get(r.body, 'status')),
          ),
          `status ${String(get(r.body, 'status'))}`,
        ]),
    });

    // ---- Hotels
    add({
      requirement: 'HTL-01',
      name: 'admin creates hotel',
      as: 'admin',
      method: 'POST',
      path: '/api/hotels',
      body: {
        name: `Audit Hotel ${TAG}`,
        address: '1 Audit St',
        cityId: 'cairo',
        description: 'Audit',
        starRating: 3,
        amenities: ['wifi'],
      },
      expect: 201,
      check: (r) =>
        all([
          get(r.body, 'countryCode') !== undefined ||
            get(r.body, 'country') !== undefined ||
            get(r.body, 'cityId') === 'cairo',
          'no city',
        ]),
    });
    add({
      requirement: 'HTL-01',
      name: 'moderator edits hotel',
      as: 'hotelMod',
      method: 'PATCH',
      path: () => `/api/hotels/${need('hotelId')}`,
      body: { amenities: ['wifi', 'pool'] },
      expect: 200,
      check: (r) =>
        all([
          arr(get(r.body, 'amenities')).includes('pool'),
          'amenities not saved',
        ]),
    });
    add({
      requirement: 'HTL-01',
      name: 'hotel photo',
      as: 'hotelMod',
      method: 'POST',
      path: () => `/api/hotels/${need('hotelId')}/photos`,
      file: png(),
      expect: [200, 201],
      check: (r) => {
        const photos = arr(get(r.body, 'photos'));
        W.photoId = idOf(photos.at(-1)) ?? '';
        return all([photos.length > 0, 'no photos']);
      },
    });
    add({
      requirement: 'HTL-02',
      name: 'hotel details',
      as: 'guest',
      method: 'GET',
      path: () =>
        `/api/hotels/${need('hotelId')}?checkIn=${ymd(40)}&checkOut=${ymd(42)}`,
      expect: 200,
      check: (r) => {
        const missing = has(
          r.body,
          'name',
          'amenities',
          'photos',
          'checkInTime',
          'checkOutTime',
          'ratingSummary',
        );
        return all(
          [missing.length === 0, `missing ${missing.join(',')}`],
          [
            JSON.stringify(r.body).includes('refundPercent'),
            'no cancellation policy',
          ],
        );
      },
    });
    add({
      requirement: 'HTL-03',
      name: 'add room',
      as: 'hotelMod',
      method: 'POST',
      path: () => `/api/hotels/${need('hotelId')}/rooms`,
      body: {
        name: `Audit Room ${TAG}`,
        type: 'Standard',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10000,
      },
      expect: 201,
      check: (r) => {
        W.auditRoom = idOf(r.body) ?? '';
        return null;
      },
    });
    add({
      requirement: 'HTL-03',
      name: 'duplicate room name rejected',
      as: 'hotelMod',
      method: 'POST',
      path: () => `/api/hotels/${need('hotelId')}/rooms`,
      body: {
        name: `Audit Room ${TAG}`,
        type: 'Standard',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10000,
      },
      expect: 409,
    });
    add({
      requirement: 'HTL-03',
      name: 'zero occupancy rejected',
      as: 'hotelMod',
      method: 'POST',
      path: () => `/api/hotels/${need('hotelId')}/rooms`,
      body: {
        name: `Audit Zero ${TAG}`,
        type: 'Standard',
        beds: 1,
        maxOccupancy: 0,
        pricePerNightMinor: 10000,
      },
      expect: 400,
    });
    add({
      requirement: 'HTL-03',
      name: 'rooms list',
      as: 'hotelMod',
      method: 'GET',
      path: () => `/api/hotels/${need('hotelId')}/rooms`,
      expect: 200,
      check: (r) =>
        all([listHas(r.body, W.auditRoom ?? ''), 'new room not listed']),
    });
    add({
      requirement: 'HTL-04',
      name: 'add bookable range',
      as: 'hotelMod',
      method: 'POST',
      path: () =>
        `/api/hotels/${need('hotelId')}/rooms/${need('auditRoom')}/availability`,
      body: { fromDate: ymd(1), toDate: ymd(30) },
      expect: [200, 201],
    });
    add({
      requirement: 'HTL-04',
      name: 'overlapping range rejected',
      as: 'hotelMod',
      method: 'POST',
      path: () =>
        `/api/hotels/${need('hotelId')}/rooms/${need('auditRoom')}/availability`,
      body: { fromDate: ymd(10), toDate: ymd(40) },
      expect: [400, 409],
    });
    add({
      requirement: 'HTL-05',
      name: 'edit room',
      as: 'hotelMod',
      method: 'PATCH',
      path: () => `/api/hotels/${need('hotelId')}/rooms/${need('auditRoom')}`,
      body: { beds: 2, maxOccupancy: 3, pricePerNightMinor: 11000 },
      expect: 200,
      check: (r) =>
        all([get(r.body, 'pricePerNightMinor') === 11000, 'price not saved']),
    });
    add({
      requirement: 'HTL-05',
      name: 'set availability',
      as: 'hotelMod',
      method: 'PATCH',
      path: () =>
        `/api/hotels/${need('hotelId')}/rooms/${need('auditRoom')}/availability`,
      body: {
        op: 'SET_RANGES',
        ranges: [{ fromDate: ymd(1), toDate: ymd(60) }],
      },
      expect: 200,
    });
    add({
      requirement: 'HTL-05',
      name: 'remove availability under a confirmed reservation rejected',
      as: 'hotelMod',
      method: 'PATCH',
      path: () =>
        `/api/hotels/${need('hotelId')}/rooms/${need('roomA')}/availability`,
      body: {
        op: 'SET_RANGES',
        ranges: [{ fromDate: ymd(30), toDate: ymd(60) }],
      },
      expect: 409,
    });
    add({
      requirement: 'HTL-06',
      name: 'block dates',
      as: 'hotelMod',
      method: 'PATCH',
      path: () =>
        `/api/hotels/${need('hotelId')}/rooms/${need('auditRoom')}/availability`,
      body: { op: 'BLOCK', fromDate: ymd(5), toDate: ymd(6) },
      expect: 200,
    });
    add({
      requirement: 'HTL-06',
      name: 'block over a reservation rejected',
      as: 'hotelMod',
      method: 'PATCH',
      path: () =>
        `/api/hotels/${need('hotelId')}/rooms/${need('roomA')}/availability`,
      body: { op: 'BLOCK', fromDate: ymd(20), toDate: ymd(21) },
      expect: 409,
    });
    add({
      requirement: 'HTL-06',
      name: 'deactivate room',
      as: 'hotelMod',
      method: 'PATCH',
      path: () => `/api/hotels/${need('hotelId')}/rooms/${need('auditRoom')}`,
      body: { isActive: false },
      expect: 200,
    });
    add({
      requirement: 'HTL-06',
      name: 'delete never-reserved room',
      as: 'hotelMod',
      method: 'DELETE',
      path: () => `/api/hotels/${need('hotelId')}/rooms/${need('roomD')}`,
      expect: [200, 204],
    });
    add({
      requirement: 'HTL-06',
      name: 'delete reserved room rejected',
      as: 'hotelMod',
      method: 'DELETE',
      path: () => `/api/hotels/${need('hotelId')}/rooms/${need('roomA')}`,
      expect: 409,
    });
    add({
      requirement: 'HTL-08',
      name: 'room status by range',
      as: 'hotelMod',
      method: 'GET',
      path: () =>
        `/api/hotels/${need('hotelId')}/availability?from=${ymd(19)}&to=${ymd(23)}`,
      expect: 200,
      check: (r) => {
        const text = JSON.stringify(r.body).toLowerCase();
        return all([
          text.includes('booked') && text.includes('available'),
          'no booked/available statuses',
        ]);
      },
    });
    add({
      requirement: 'HTL-09',
      name: 'check-in/out times',
      as: 'hotelMod',
      method: 'PUT',
      path: () => `/api/hotels/${need('hotelId')}/policies`,
      body: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationPolicy: { tiers: HOTEL_TIERS },
      },
      expect: 200,
      check: (r) =>
        all([
          get(r.body, 'checkInTime') === '14:00',
          'check-in time not saved',
        ]),
    });
    add({
      requirement: 'HTL-10',
      name: 'hotel cancellation tiers',
      as: 'hotelMod',
      method: 'PUT',
      path: () => `/api/hotels/${need('hotelId')}/policies`,
      body: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationPolicy: { tiers: HOTEL_TIERS },
      },
      expect: 200,
      check: (r) =>
        all([
          JSON.stringify(r.body).includes('refundPercent'),
          'tiers not echoed',
        ]),
    });
    add({
      requirement: 'HTL-10',
      name: 'percent over 100 rejected',
      as: 'hotelMod',
      method: 'PUT',
      path: () => `/api/hotels/${need('hotelId')}/policies`,
      body: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationPolicy: { tiers: [{ daysBefore: 1, refundPercent: 150 }] },
      },
      expect: 400,
    });
    add({
      requirement: 'HTL-11',
      name: 'hotel search',
      as: 'guest',
      method: 'GET',
      path: `/api/hotels/search?cityId=cairo&checkIn=${ymd(40)}&checkOut=${ymd(42)}&guests=2`,
      expect: 200,
      check: (r) => all([items(r.body).length > 0, 'nothing found']),
    });
    add({
      requirement: 'HTL-11',
      name: 'check-in in the past rejected',
      as: 'guest',
      method: 'GET',
      path: `/api/hotels/search?cityId=cairo&checkIn=${ymd(-3)}&checkOut=${ymd(2)}&guests=2`,
      expect: 400,
    });
    add({
      requirement: 'HTL-11',
      name: 'check-out before check-in rejected',
      as: 'guest',
      method: 'GET',
      path: `/api/hotels/search?cityId=cairo&checkIn=${ymd(42)}&checkOut=${ymd(40)}&guests=2`,
      expect: 400,
    });
    add({
      requirement: 'HTL-12',
      name: 'price filter and sort',
      as: 'guest',
      method: 'GET',
      path: `/api/hotels/search?countryCode=AE&checkIn=${ymd(40)}&checkOut=${ymd(42)}&guests=2&minPrice=1000&maxPrice=100000&sortBy=price`,
      expect: 200,
      check: (r) => {
        const prices = items(r.body).map(
          (h) => num(get(h, 'pricePerNightMinor')) ?? -1,
        );
        return all(
          [prices.length > 0, 'nothing found'],
          [sorted(prices), 'not sorted'],
          [prices.every((p) => p >= 1000 && p <= 100000), 'outside range'],
        );
      },
    });
    add({
      requirement: 'HTL-12',
      name: 'min rating excludes unrated',
      as: 'guest',
      method: 'GET',
      path: `/api/hotels/search?cityId=dubai&checkIn=${ymd(40)}&checkOut=${ymd(42)}&guests=2&minRating=1`,
      expect: 200,
      check: (r) =>
        all([
          items(r.body).every(
            (h) => (num(get(h, 'ratingSummary.average')) ?? 0) >= 1,
          ),
          'an unrated hotel listed',
        ]),
    });
    add({
      requirement: 'HTL-15',
      name: 'free rooms with totals',
      as: 'guest',
      method: 'GET',
      path: () =>
        `/api/hotels/${need('hotelId')}/rooms/available?checkIn=${ymd(40)}&checkOut=${ymd(42)}`,
      expect: 200,
      check: (r) => {
        const first = items(r.body)[0];
        const missing = has(
          first,
          'type',
          'beds',
          'maxOccupancy',
          'pricePerNightMinor',
        );
        return all(
          [missing.length === 0, `missing ${missing.join(',')}`],
          [
            Object.keys(isRecord(first) ? first : {}).some((k) =>
              /total/i.test(k),
            ),
            'no total stay price',
          ],
        );
      },
    });
    add({
      requirement: 'HTL-16',
      name: 'book rooms',
      as: 'otherUser',
      method: 'POST',
      path: '/api/hotel-bookings',
      body: () => ({
        hotelId: need('hotelId'),
        checkInDate: ymd(45),
        checkOutDate: ymd(47),
        rooms: [{ roomId: need('roomA'), adults: 1, childAges: [5] }],
      }),
      expect: 201,
      check: (r) =>
        all([
          JSON.stringify(r.body).includes(String(2 * Number(W.roomAPrice))),
          `total is not 2 nights x ${String(W.roomAPrice)}`,
        ]),
    });
    add({
      requirement: 'HTL-16',
      name: 'over occupancy rejected',
      as: 'otherUser',
      method: 'POST',
      path: '/api/hotel-bookings',
      body: () => ({
        hotelId: need('hotelId'),
        checkInDate: ymd(50),
        checkOutDate: ymd(51),
        rooms: [{ roomId: need('roomB'), adults: 5, childAges: [] }],
      }),
      expect: [400, 409],
    });
    add({
      requirement: 'HTL-16',
      name: 'no adult rejected',
      as: 'otherUser',
      method: 'POST',
      path: '/api/hotel-bookings',
      body: () => ({
        hotelId: need('hotelId'),
        checkInDate: ymd(50),
        checkOutDate: ymd(51),
        rooms: [{ roomId: need('roomB'), adults: 0, childAges: [5] }],
      }),
      expect: 400,
    });
    add({
      requirement: 'HTL-17',
      name: 'confirmed reservation',
      as: 'user',
      method: 'GET',
      path: () => hb('r1'),
      expect: 200,
      check: (r) =>
        all(
          [get(r.body, 'status') === 'confirmed', 'not confirmed'],
          [str(get(r.body, 'reference')) !== undefined, 'no reference'],
        ),
    });
    add({
      requirement: 'HTL-18',
      name: 'hold rooms 10 minutes',
      as: 'otherUser',
      method: 'POST',
      path: '/api/hotel-bookings',
      body: () => ({
        hotelId: need('hotelId'),
        checkInDate: ymd(55),
        checkOutDate: ymd(56),
        rooms: [{ roomId: need('roomB'), adults: 1, childAges: [] }],
      }),
      expect: 201,
      check: (r) => {
        const left =
          Date.parse(str(get(r.body, 'holdExpiresAt')) ?? '') - Date.now();
        return all([
          left > 8 * 60_000 && left <= 10 * 60_000 + 5000,
          `hold of ${left} ms`,
        ]);
      },
    });
    add({
      requirement: 'HTL-18',
      name: 'overlapping hold rejected',
      as: 'otherUser',
      method: 'POST',
      path: '/api/hotel-bookings',
      body: () => ({
        hotelId: need('hotelId'),
        checkInDate: ymd(21),
        checkOutDate: ymd(23),
        rooms: [{ roomId: need('roomA'), adults: 1, childAges: [] }],
      }),
      expect: 409,
      check: (r) =>
        all([
          get(r.body, 'code') === ErrorCode.RoomsUnavailable,
          `code ${String(get(r.body, 'code'))}`,
        ]),
    });
    add({
      requirement: 'HTL-20',
      name: 'my reservations grouped',
      as: 'user',
      method: 'GET',
      path: '/api/hotel-bookings?group=upcoming',
      expect: 200,
      check: (r) => all([listHas(r.body, W.r1 ?? ''), 'R1 not in upcoming']),
    });
    add({
      requirement: 'HTL-21',
      name: 'refund preview',
      as: 'user',
      method: 'GET',
      path: () => `${hb('r2')}/refund-preview`,
      expect: 200,
      check: (r) =>
        all([
          get(r.body, 'percent') === 100,
          `percent ${String(get(r.body, 'percent'))} (20 days before, tier 14d=100%)`,
        ]),
    });
    add({
      requirement: 'HTL-21',
      name: 'cancel reservation',
      as: 'user',
      method: 'POST',
      path: () => `${hb('r2')}/cancel`,
      body: {},
      expect: 200,
      check: (r) =>
        all([get(r.body, 'status') === 'cancelled', 'not cancelled']),
    });
    add({
      requirement: 'HTL-22',
      name: 'hotel reservations',
      as: 'hotelMod',
      method: 'GET',
      path: () => `/api/hotels/${need('hotelId')}/reservations?limit=50`,
      expect: 200,
      check: (r) =>
        all([
          listHas(r.body, W.r1 ?? '') ||
            JSON.stringify(r.body).includes(W.r1 ?? '-'),
          'R1 not listed',
        ]),
    });
    add({
      requirement: 'HTL-23',
      name: 'review a completed stay',
      as: 'user',
      method: 'POST',
      path: () => `${hb('r3')}/review`,
      body: { rating: 5, text: 'Audit review' },
      expect: 201,
      check: (r) => {
        W.review = idOf(r.body) ?? '';
        return null;
      },
    });
    add({
      requirement: 'HTL-23',
      name: 'second review rejected',
      as: 'user',
      method: 'POST',
      path: () => `${hb('r3')}/review`,
      body: { rating: 4 },
      expect: 409,
    });
    add({
      requirement: 'HTL-23',
      name: 'review of a confirmed stay rejected',
      as: 'user',
      method: 'POST',
      path: () => `${hb('r1')}/review`,
      body: { rating: 4 },
      expect: 409,
    });
    add({
      requirement: 'HTL-23',
      name: 'edit review',
      as: 'user',
      method: 'PATCH',
      path: () => `/api/reviews/${need('review')}`,
      body: { rating: 4 },
      expect: 200,
    });
    add({
      requirement: 'HTL-24',
      name: 'hotel reviews',
      as: 'guest',
      method: 'GET',
      path: () => `/api/hotels/${need('hotelId')}/reviews`,
      expect: 200,
      check: (r) => all([listHas(r.body, W.review ?? ''), 'review not listed']),
    });
    add({
      requirement: 'HTL-23',
      name: 'delete review',
      as: 'user',
      method: 'DELETE',
      path: () => `/api/reviews/${need('review')}`,
      expect: [200, 204],
    });

    // ---- Payments
    add({
      requirement: 'PAY-02',
      name: 'payment before acceptance blocked',
      as: 'user',
      method: 'POST',
      path: '/api/payments',
      body: () => ({ bookingType: 'flight', bookingId: need('b5') }),
      expect: 409,
      check: (r) =>
        all([
          get(r.body, 'code') === ErrorCode.PoliciesNotAccepted,
          'code not POLICIES_NOT_ACCEPTED',
        ]),
    });
    add({
      requirement: 'PAY-02',
      name: 'policies shown',
      as: 'user',
      method: 'GET',
      path: () => `/api/bookings/flight/${need('b5')}/policies`,
      expect: 200,
      check: (r) =>
        all(
          [get(r.body, 'accepted') === false, 'already accepted'],
          [
            /bag/i.test(JSON.stringify(r.body)) &&
              JSON.stringify(r.body).includes('refundPercent'),
            'no baggage/cancellation policy',
          ],
        ),
    });
    add({
      requirement: 'PAY-02',
      name: 'accept policies',
      as: 'user',
      method: 'POST',
      path: () => `/api/bookings/flight/${need('b5')}/accept-policies`,
      body: { accepted: true },
      expect: 200,
      check: (r) =>
        all(
          [get(r.body, 'accepted') === true, 'not accepted'],
          [
            Object.keys(isRecord(r.body) ? r.body : {}).some((k) =>
              k.endsWith('At'),
            ),
            'no acceptance timestamp',
          ],
        ),
    });
    add({
      requirement: 'PAY-04',
      name: 'payment in platform currency',
      as: 'user',
      method: 'POST',
      path: '/api/payments',
      body: () => ({ bookingType: 'flight', bookingId: need('b5') }),
      expect: 201,
      check: (r) =>
        all([
          get(r.body, 'currency') === CURRENCY,
          `currency ${String(get(r.body, 'currency'))}`,
        ]),
    });
    add({
      requirement: 'PAY-04',
      name: 'quote in platform currency',
      as: 'user',
      method: 'POST',
      path: '/api/flight-bookings',
      body: () => quote(0),
      expect: 200,
      check: (r) =>
        all([get(r.body, 'pricing.currency') === CURRENCY, 'quote currency']),
    });
    add({
      requirement: 'PAY-01',
      name: 'start payment',
      as: 'user',
      method: 'POST',
      path: '/api/payments',
      body: () => ({ bookingType: 'flight', bookingId: need('b3') }),
      expect: 201,
      check: (r) => {
        W.b3Payment = str(get(r.body, 'paymentId')) ?? '';
        W.b3Intent = (str(get(r.body, 'clientSecret')) ?? '').replace(
          /_secret$/,
          '',
        );
        return all(
          [W.b3Intent !== '', 'no client secret'],
          [
            !/card|number|cvc/i.test(JSON.stringify(r.body)),
            'card details in body',
          ],
        );
      },
    });
    add({
      requirement: 'PAY-01',
      name: 'webhook payment_intent.succeeded',
      as: 'guest',
      method: 'POST',
      path: '/api/payments/webhook',
      expect: 200,
      run: async () => {
        const res = await app.webhook.paymentSucceeded(need('b3Intent'));
        return {
          status: res.status,
          body: res.body as unknown,
          headers: res.headers as Res['headers'],
        };
      },
    });
    add({
      requirement: 'PAY-01',
      name: 'payment succeeded and booking confirmed',
      as: 'user',
      method: 'GET',
      path: () => `/api/payments/${need('b3Payment')}`,
      expect: 200,
      check: async (r) => {
        const confirmed = await poll(
          async () =>
            get((await as('user', 'GET', fb('b3'))).body, 'status') ===
            'confirmed',
        );
        return all(
          [
            get(r.body, 'status') === 'succeeded',
            `payment ${String(get(r.body, 'status'))}`,
          ],
          [confirmed, 'booking not confirmed'],
        );
      },
    });
    add({
      requirement: 'PAY-01',
      name: 'retry after failure',
      as: 'user',
      method: 'POST',
      path: () => `/api/payments/${need('b4Payment')}/retry`,
      expect: [200, 201],
      check: (r) =>
        all([
          str(get(r.body, 'clientSecret')) !== undefined,
          'no client secret',
        ]),
    });
    add({
      requirement: 'PAY-01',
      name: 'webhook bad signature rejected',
      as: 'guest',
      method: 'POST',
      path: '/api/payments/webhook',
      expect: 400,
      run: async () => {
        const res = await request(app.t.app.getHttpServer())
          .post('/api/payments/webhook')
          .set('stripe-signature', 'bad')
          .set('Content-Type', 'application/json')
          .send('{"type":"x"}');
        return {
          status: res.status,
          body: res.body as unknown,
          headers: res.headers as Res['headers'],
        };
      },
      check: (r) =>
        all([
          get(r.body, 'code') === ErrorCode.BadSignature,
          'code not BAD_SIGNATURE',
        ]),
    });
    add({
      requirement: 'PAY-03',
      name: 'refund recorded pending',
      as: 'user',
      method: 'GET',
      path: () => `/api/refunds/${need('refundId')}`,
      expect: 200,
      check: (r) =>
        all(
          [
            get(r.body, 'status') === 'pending',
            `status ${String(get(r.body, 'status'))}`,
          ],
          [get(r.body, 'currency') === CURRENCY, 'refund currency'],
        ),
    });
    add({
      requirement: 'PAY-03',
      name: 'refund webhook marks refunded',
      as: 'guest',
      method: 'POST',
      path: '/api/payments/webhook',
      expect: 200,
      run: async () => {
        const id = need('refundId');
        const rec = await app.t.connection
          .collection<{ _id: Types.ObjectId; stripeRefundId?: string }>(
            'refunds',
          )
          .findOne({ _id: new Types.ObjectId(id) });
        const res = await app.webhook.refund(
          rec?.stripeRefundId ?? 'missing',
          'succeeded',
          id,
        );
        return {
          status: res.status,
          body: res.body as unknown,
          headers: res.headers as Res['headers'],
        };
      },
      check: async () => {
        const ok = await poll(
          async () =>
            get(
              (await as('user', 'GET', `/api/refunds/${need('refundId')}`))
                .body,
              'status',
            ) === 'refunded',
        );
        return all([ok, 'refund never became refunded']);
      },
    });

    // ---- Itineraries
    const itn = (rest = '') => `/api/itineraries/${need('itn')}${rest}`;
    const day = (i: number) => need('days').split(',')[i] ?? NONE_ID;
    add({
      requirement: 'ITN-01',
      name: 'create itinerary',
      as: 'user',
      method: 'POST',
      path: '/api/itineraries',
      body: { title: 'Audit ITN-01', countryCodes: ['EG'], startDate: ymd(30) },
      expect: 201,
      check: (r) =>
        all([
          get(r.body, 'visibility') === 'private',
          `visibility ${String(get(r.body, 'visibility'))}`,
        ]),
    });
    add({
      requirement: 'ITN-01',
      name: 'title over 100 rejected',
      as: 'user',
      method: 'POST',
      path: '/api/itineraries',
      body: {
        title: 'x'.repeat(101),
        countryCodes: ['EG'],
        startDate: ymd(30),
      },
      expect: 400,
    });
    add({
      requirement: 'ITN-01',
      name: 'unknown country rejected',
      as: 'user',
      method: 'POST',
      path: '/api/itineraries',
      body: { title: 'Bad', countryCodes: ['ZZ'], startDate: ymd(30) },
      expect: [400, 404],
    });
    add({
      requirement: 'ITN-01',
      name: 'edit itinerary',
      as: 'user',
      method: 'PATCH',
      path: () => itn(),
      body: { title: `Audit trip ${TAG} edited` },
      expect: 200,
      check: (r) =>
        all([
          get(r.body, 'title') === `Audit trip ${TAG} edited`,
          'title not saved',
        ]),
    });
    add({
      requirement: 'ITN-01',
      name: 'delete itinerary',
      as: 'user',
      method: 'DELETE',
      path: () => `/api/itineraries/${need('itnDel')}`,
      expect: [200, 204],
    });
    add({
      requirement: 'ITN-03',
      name: 'my itineraries',
      as: 'user',
      method: 'GET',
      path: '/api/itineraries',
      expect: 200,
      check: (r) => {
        const rows = items(r.body);
        const t = rows.map((x) => Date.parse(str(get(x, 'updatedAt')) ?? ''));
        return all(
          [listHas(r.body, W.itn ?? ''), 'itinerary not listed'],
          [
            t.every((x, i) => i === 0 || (t[i - 1] ?? 0) >= x),
            'not most recently updated first',
          ],
          [
            !rows.some((x) => idOf(x) === W.itnDel),
            'deleted itinerary still listed',
          ],
        );
      },
    });
    add({
      requirement: 'ITN-03',
      name: 'itinerary details',
      as: 'user',
      method: 'GET',
      path: () => itn(),
      expect: 200,
      check: (r) =>
        all([
          arr(get(r.body, 'days')).length === 4,
          `${arr(get(r.body, 'days')).length} days`,
        ]),
    });
    add({
      requirement: 'ITN-05',
      name: 'add day',
      as: 'user',
      method: 'POST',
      path: () => itn('/days'),
      body: { cityId: 'cairo' },
      expect: 201,
      check: (r) => {
        W.day5 = idOf(r.body) ?? '';
        return all(
          [
            get(r.body, 'dayNumber') === 5 || get(r.body, 'number') === 5,
            `day number ${String(get(r.body, 'dayNumber'))}`,
          ],
          [get(r.body, 'date') !== undefined, 'no date'],
        );
      },
    });
    add({
      requirement: 'ITN-05',
      name: 'edit day',
      as: 'user',
      method: 'PATCH',
      path: () => itn(`/days/${day(1)}`),
      body: { cityId: 'dubai', notes: 'Audit notes' },
      expect: 200,
    });
    add({
      requirement: 'ITN-05',
      name: 'unknown city rejected',
      as: 'user',
      method: 'POST',
      path: () => itn('/days'),
      body: { cityId: 'atlantis' },
      expect: [400, 404],
    });
    add({
      requirement: 'ITN-07',
      name: 'delete day',
      as: 'user',
      method: 'DELETE',
      path: () => itn(`/days/${need('day5')}`),
      expect: [200, 204],
    });
    add({
      requirement: 'ITN-08',
      name: 'reorder days',
      as: 'user',
      method: 'PATCH',
      path: () => itn('/days/reorder'),
      body: () => ({ dayIds: [day(1), day(0), day(2), day(3)] }),
      expect: 200,
      check: (r) =>
        all([
          idOf(arr(get(r.body, 'days'))[0]) === day(1),
          'order not applied',
        ]),
    });
    add({
      requirement: 'ITN-09',
      name: 'city groups',
      as: 'user',
      method: 'GET',
      path: () => itn(),
      expect: 200,
      check: (r) => {
        const key = Object.keys(isRecord(r.body) ? r.body : {}).find((k) =>
          /group/i.test(k),
        );
        const groups = arr(key ? get(r.body, key) : undefined);
        return all([
          groups.length === 2,
          `${groups.length} groups (want dubai x2, cairo x2)`,
        ]);
      },
    });
    add({
      requirement: 'ITN-10',
      name: 'add activity',
      as: 'user',
      method: 'POST',
      path: () => itn(`/days/${day(0)}/activities`),
      body: { name: 'Audit museum', description: 'Desc' },
      expect: 201,
    });
    add({
      requirement: 'ITN-10',
      name: 'edit activity',
      as: 'user',
      method: 'PATCH',
      path: () => `/api/activities/${need('act')}`,
      body: { name: 'Burj Khalifa top' },
      expect: 200,
    });
    add({
      requirement: 'ITN-12',
      name: 'activity image',
      as: 'user',
      method: 'POST',
      path: () => `/api/activities/${need('act')}/images`,
      file: png(),
      expect: 201,
    });
    add({
      requirement: 'ITN-12',
      name: 'remove activity image',
      as: 'user',
      method: 'DELETE',
      path: () => `/api/activities/${need('act2')}/images/${need('actImage')}`,
      expect: [200, 204],
    });
    add({
      requirement: 'ITN-10',
      name: 'delete activity',
      as: 'user',
      method: 'DELETE',
      path: () => `/api/activities/${need('act2')}`,
      expect: [200, 204],
    });
    add({
      requirement: 'ITN-14',
      name: 'add budget',
      as: 'user',
      method: 'POST',
      path: () => itn(`/days/${day(1)}/budgets`),
      body: {
        category: 'accommodation',
        amountMinor: 9000,
        currency: CURRENCY,
      },
      expect: 201,
    });
    add({
      requirement: 'ITN-14',
      name: 'negative budget rejected',
      as: 'user',
      method: 'POST',
      path: () => itn(`/days/${day(1)}/budgets`),
      body: { category: 'food', amountMinor: -1, currency: CURRENCY },
      expect: 400,
    });
    add({
      requirement: 'ITN-14',
      name: 'edit budget',
      as: 'user',
      method: 'PATCH',
      path: () => `/api/budgets/${need('budget')}`,
      body: { amountMinor: 700 },
      expect: 200,
    });
    add({
      requirement: 'ITN-14',
      name: 'budget summary',
      as: 'user',
      method: 'GET',
      path: () => itn('/budget-summary'),
      expect: 200,
      check: (r) => {
        const text = JSON.stringify(r.body);
        return all(
          [get(r.body, 'total') !== undefined, 'no total'],
          [
            /categor/i.test(text) && /day/i.test(text),
            'no by-category/by-day breakdown',
          ],
        );
      },
    });
    add({
      requirement: 'ITN-16',
      name: 'add transport',
      as: 'user',
      method: 'POST',
      path: () => itn('/transport-costs'),
      body: () => ({
        mode: 'train',
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amountMinor: 3000,
        currency: CURRENCY,
        dayId: day(2),
      }),
      expect: 201,
    });
    add({
      requirement: 'ITN-16',
      name: 'edit transport',
      as: 'user',
      method: 'PATCH',
      path: () => `/api/transport-costs/${need('transport')}`,
      body: { amountMinor: 21000 },
      expect: 200,
    });
    add({
      requirement: 'ITN-16',
      name: 'delete transport',
      as: 'user',
      method: 'DELETE',
      path: () => `/api/transport-costs/${need('transport2')}`,
      expect: [200, 204],
    });
    add({
      requirement: 'ITN-18',
      name: 'summary in preferred currency',
      as: 'user',
      method: 'GET',
      path: () => itn('/budget-summary'),
      expect: 200,
      check: (r) => {
        const text = JSON.stringify(r.body);
        return all(
          [text.includes('"EUR"'), 'not converted to EUR (preferred currency)'],
          [/rateDate/i.test(text), 'no rate date'],
        );
      },
    });
    add({
      requirement: 'ITN-18',
      name: 'latest rates',
      as: 'user',
      method: 'GET',
      path: '/api/exchange-rates/latest',
      expect: 200,
      check: (r) => all([get(r.body, 'rates') !== undefined, 'no rates']),
    });
    add({
      requirement: 'ITN-20',
      name: 'set public',
      as: 'user',
      method: 'PATCH',
      path: () => itn(),
      body: { visibility: 'public' },
      expect: 200,
    });
    add({
      requirement: 'ITN-20',
      name: 'public search finds it',
      as: 'guest',
      method: 'GET',
      path: `/api/itineraries/public/search?q=${TAG}`,
      expect: 200,
      check: (r) => all([listHas(r.body, W.itn ?? ''), 'not found']),
    });
    add({
      requirement: 'ITN-20',
      name: 'read-only for others',
      as: 'otherUser',
      method: 'PATCH',
      path: () => itn(),
      body: { title: 'Hijack' },
      expect: [403, 404],
    });
    add({
      requirement: 'ITN-21',
      name: 'search by city and duration',
      as: 'guest',
      method: 'GET',
      path: `/api/itineraries/public/search?q=dubai&minDays=2&maxDays=10`,
      expect: 200,
      check: (r) =>
        all([listHas(r.body, W.itn ?? ''), 'not found by city keyword']),
    });
    add({
      requirement: 'ITN-21',
      name: 'public itinerary',
      as: 'guest',
      method: 'GET',
      path: () => `/api/itineraries/public/${need('itn')}`,
      expect: 200,
      check: (r) =>
        all(
          [
            get(r.body, 'author') !== undefined ||
              get(r.body, 'authorName') !== undefined,
            'no author',
          ],
          [arr(get(r.body, 'days')).length > 0, 'no days'],
        ),
    });
    add({
      requirement: 'ITN-21',
      name: 'clone',
      as: 'otherUser',
      method: 'POST',
      path: () => itn('/clone'),
      expect: 201,
      check: (r) =>
        all(
          [idOf(r.body) !== W.itn, 'same id'],
          [get(r.body, 'visibility') === 'private', 'clone not private'],
          [arr(get(r.body, 'days')).length === 4, 'days not cloned'],
          [
            JSON.stringify(r.body).includes(W.userId ?? '-'),
            'original author not credited',
          ],
        ),
    });
    add({
      requirement: 'ITN-25',
      name: 'hotels for a city group',
      as: 'user',
      method: 'GET',
      path: () => itn('/hotels?groupIndex=0&guests=2&rooms=1'),
      expect: 200,
      check: (r) =>
        all([
          items(r.body).length > 0 || items(get(r.body, 'hotels')).length > 0,
          'no hotels',
        ]),
    });
    add({
      requirement: 'ITN-26',
      name: 'flights to the first city',
      as: 'user',
      method: 'GET',
      path: () => itn('/flights?origin=CAI&adults=1'),
      expect: 200,
      check: (r) =>
        all([
          JSON.stringify(r.body).includes('DXB') ||
            JSON.stringify(r.body).includes('flightNumber'),
          'no flights to Dubai',
        ]),
    });

    // ---- Blog
    add({
      requirement: 'BLG-01',
      name: 'create post',
      as: 'user',
      method: 'POST',
      path: '/api/posts',
      body: { title: 'Audit BLG-01', body: 'Body', status: 'published' },
      expect: 201,
      check: (r) =>
        all([get(r.body, 'status') === 'published', 'not published']),
    });
    add({
      requirement: 'BLG-01',
      name: 'missing body rejected',
      as: 'user',
      method: 'POST',
      path: '/api/posts',
      body: { title: 'No body', status: 'published' },
      expect: 400,
    });
    add({
      requirement: 'BLG-02',
      name: 'posts by tag',
      as: 'guest',
      method: 'GET',
      path: `/api/posts?tag=${TAG}`,
      expect: 200,
      check: (r) =>
        all(
          [listHas(r.body, W.post ?? ''), 'post not listed'],
          [!listHas(r.body, W.draft ?? ''), 'draft listed'],
        ),
    });
    add({
      requirement: 'BLG-02',
      name: 'post page',
      as: 'guest',
      method: 'GET',
      path: () => `/api/posts/${need('post')}`,
      expect: 200,
      check: (r) => {
        const missing = has(
          r.body,
          'title',
          'body',
          'tags',
          'images',
          'createdAt',
        );
        const text = JSON.stringify(r.body);
        return all(
          [missing.length === 0, `missing ${missing.join(',')}`],
          [/like/i.test(text), 'no like count'],
          [/author/i.test(text), 'no author'],
        );
      },
    });
    add({
      requirement: 'BLG-03',
      name: 'my posts incl. drafts',
      as: 'user',
      method: 'GET',
      path: '/api/posts/mine',
      expect: 200,
      check: (r) =>
        all(
          [listHas(r.body, W.draft ?? ''), 'draft not listed'],
          [
            items(r.body).every((p) => get(p, 'status') !== undefined),
            'no status',
          ],
        ),
    });
    add({
      requirement: 'BLG-04',
      name: 'edit own post',
      as: 'user',
      method: 'PATCH',
      path: () => `/api/posts/${need('post')}`,
      body: { title: `Audit post ${TAG} edited` },
      expect: 200,
    });
    add({
      requirement: 'BLG-04',
      name: "edit someone else's post",
      as: 'otherUser',
      method: 'PATCH',
      path: () => `/api/posts/${need('post')}`,
      body: { title: 'Hijack' },
      expect: [403, 404],
    });
    add({
      requirement: 'BLG-04',
      name: 'delete own post',
      as: 'user',
      method: 'DELETE',
      path: () => `/api/posts/${need('draft')}`,
      expect: [200, 204],
    });
    add({
      requirement: 'BLG-05',
      name: 'comment',
      as: 'otherUser',
      method: 'POST',
      path: () => `/api/posts/${need('post')}/comments`,
      body: { body: 'Third comment' },
      expect: 201,
    });
    add({
      requirement: 'BLG-05',
      name: 'empty comment rejected',
      as: 'otherUser',
      method: 'POST',
      path: () => `/api/posts/${need('post')}/comments`,
      body: { body: '' },
      expect: 400,
    });
    add({
      requirement: 'BLG-05',
      name: 'comment over 500 rejected',
      as: 'otherUser',
      method: 'POST',
      path: () => `/api/posts/${need('post')}/comments`,
      body: { body: 'x'.repeat(501) },
      expect: 400,
    });
    add({
      requirement: 'BLG-05',
      name: 'comments chronological',
      as: 'guest',
      method: 'GET',
      path: () => `/api/posts/${need('post')}/comments`,
      expect: 200,
      check: (r) => {
        const t = items(r.body).map((c) =>
          Date.parse(str(get(c, 'createdAt')) ?? ''),
        );
        return all(
          [t.length >= 2, 'fewer than 2 comments'],
          [sorted(t), 'not chronological'],
        );
      },
    });
    add({
      requirement: 'BLG-06',
      name: 'like',
      as: 'otherUser',
      method: 'POST',
      path: () => `/api/posts/${need('post')}/like`,
      expect: [200, 201, 204],
    });
    add({
      requirement: 'BLG-06',
      name: 'double like counts once',
      as: 'otherUser',
      method: 'POST',
      path: () => `/api/posts/${need('post')}/like`,
      expect: [200, 201, 204, 409],
      check: async () => {
        const p = await as('guest', 'GET', `/api/posts/${need('post')}`);
        return all([
          get(p.body, 'likeCount') === 1,
          `likeCount ${String(get(p.body, 'likeCount'))}`,
        ]);
      },
    });
    add({
      requirement: 'BLG-06',
      name: 'unlike',
      as: 'otherUser',
      method: 'DELETE',
      path: () => `/api/posts/${need('post')}/like`,
      expect: [200, 204],
      check: async () => {
        const p = await as('guest', 'GET', `/api/posts/${need('post')}`);
        return all([
          get(p.body, 'likeCount') === 0,
          `likeCount ${String(get(p.body, 'likeCount'))}`,
        ]);
      },
    });
    add({
      requirement: 'BLG-07',
      name: 'edit own comment',
      as: 'otherUser',
      method: 'PATCH',
      path: () => `/api/comments/${need('comment')}`,
      body: { body: 'Edited comment' },
      expect: 200,
    });
    add({
      requirement: 'BLG-07',
      name: "edit someone else's comment",
      as: 'user',
      method: 'PATCH',
      path: () => `/api/comments/${need('comment')}`,
      body: { body: 'Hijack' },
      expect: [403, 404],
    });
    add({
      requirement: 'BLG-07',
      name: 'delete own comment',
      as: 'otherUser',
      method: 'DELETE',
      path: () => `/api/comments/${need('comment2')}`,
      expect: [200, 204],
    });
    add({
      requirement: 'BLG-08',
      name: 'posts of a tag',
      as: 'guest',
      method: 'GET',
      path: `/api/tags/${TAG}/posts`,
      expect: 200,
      check: (r) => all([listHas(r.body, W.post ?? ''), 'post not listed']),
    });
    add({
      requirement: 'BLG-08',
      name: 'edit tags',
      as: 'user',
      method: 'PATCH',
      path: () => `/api/posts/${need('post')}`,
      body: { tags: [TAG, 'nile', 'food'] },
      expect: 200,
      check: (r) =>
        all([arr(get(r.body, 'tags')).length === 3, 'tags not saved']),
    });
    add({
      requirement: 'BLG-08',
      name: 'six tags rejected',
      as: 'user',
      method: 'PATCH',
      path: () => `/api/posts/${need('post')}`,
      body: { tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
      expect: 400,
    });
    add({
      requirement: 'BLG-08',
      name: 'tag over 30 rejected',
      as: 'user',
      method: 'PATCH',
      path: () => `/api/posts/${need('post')}`,
      body: { tags: ['x'.repeat(31)] },
      expect: 400,
    });
    add({
      requirement: 'BLG-09',
      name: 'keyword search',
      as: 'guest',
      method: 'GET',
      path: `/api/posts?q=${TAG}`,
      expect: 200,
      check: (r) => {
        const rows = items(r.body);
        return all(
          [listHas(r.body, W.post ?? ''), 'post not found by keyword'],
          [
            rows.every(
              (p) =>
                get(p, 'excerpt') !== undefined || get(p, 'body') !== undefined,
            ),
            'no excerpt',
          ],
        );
      },
    });
    add({
      requirement: 'BLG-10',
      name: 'post image',
      as: 'user',
      method: 'POST',
      path: () => `/api/posts/${need('post')}/images`,
      file: png(),
      expect: 201,
    });
    add({
      requirement: 'BLG-10',
      name: 'remove post image',
      as: 'user',
      method: 'DELETE',
      path: () => `/api/posts/${need('post')}/images/${need('postImage')}`,
      expect: [200, 204],
    });
    add({
      requirement: 'BLG-12',
      name: 'author page',
      as: 'guest',
      method: 'GET',
      path: () => `/api/authors/${need('userId')}`,
      expect: 200,
      check: (r) => {
        const text = JSON.stringify(r.body);
        return all(
          [text.includes('Audit User'), 'no name'],
          [text.includes(W.post ?? '-'), 'no published posts'],
          [text.includes(W.itn ?? '-'), 'no public itineraries'],
        );
      },
    });

    // ---- Cross-cutting
    add({
      requirement: 'GEN-01',
      name: 'notifications',
      as: 'user',
      method: 'GET',
      path: '/api/notifications?limit=50',
      expect: 200,
      check: (r) => {
        W.notification = idOf(items(r.body)[0]) ?? '';
        const types = items(r.body).map((n) => str(get(n, 'type')));
        return all(
          [types.includes('booking_confirmed'), 'no booking_confirmed'],
          [
            types.some((t) => t?.startsWith('refund')),
            'no refund notification',
          ],
        );
      },
    });
    add({
      requirement: 'GEN-01',
      name: 'unread count',
      as: 'user',
      method: 'GET',
      path: '/api/notifications/unread-count',
      expect: 200,
      check: (r) =>
        all([
          typeof (get(r.body, 'count') ?? get(r.body, 'unreadCount')) ===
            'number',
          'no count',
        ]),
    });
    add({
      requirement: 'GEN-01',
      name: 'mark read',
      as: 'user',
      method: 'PATCH',
      path: () => `/api/notifications/${need('notification')}/read`,
      expect: [200, 204],
    });
    add({
      requirement: 'GEN-02',
      name: 'field-level messages',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/register',
      body: { email: 'not-an-email' },
      expect: 400,
      check: (r) => {
        const details = arr(get(r.body, 'details'));
        return all([
          details.length > 0 &&
            details.every((d) => has(d, 'field', 'message').length === 0),
          'no {field,message} details',
        ]);
      },
    });
    add({
      requirement: 'GEN-05',
      name: 'posts page size 10',
      as: 'guest',
      method: 'GET',
      path: '/api/posts',
      expect: 200,
      check: (r) =>
        all(
          [
            get(r.body, 'limit') === 10,
            `limit ${String(get(r.body, 'limit'))}`,
          ],
          [items(r.body).length <= 10, 'more than 10 rows'],
        ),
    });
    add({
      requirement: 'GEN-05',
      name: 'accounts page size 10',
      as: 'admin',
      method: 'GET',
      path: '/api/admin/accounts',
      expect: 200,
      check: (r) =>
        all(
          [
            get(r.body, 'limit') === 10,
            `limit ${String(get(r.body, 'limit'))}`,
          ],
          [items(r.body).length === 10, `${items(r.body).length} rows`],
        ),
    });
    add({
      requirement: 'GEN-06',
      name: 'local time zones',
      as: 'guest',
      method: 'GET',
      path: () => `/api/flights/${need('flightId')}`,
      expect: 200,
      check: (r) =>
        all([
          get(r.body, 'departureTimeZone') === 'Africa/Cairo' &&
            get(r.body, 'arrivalTimeZone') === 'Asia/Dubai',
          'time zones missing',
        ]),
    });
    add({
      requirement: 'GEN-07',
      name: 'audit log',
      as: 'admin',
      method: 'GET',
      path: '/api/admin/audit-logs?limit=50',
      expect: 200,
      check: (r) =>
        all([/suspend/i.test(JSON.stringify(r.body)), 'no suspension logged']),
    });
    add({
      requirement: 'GEN-08',
      name: 'airline logo',
      as: 'airlineMod',
      method: 'POST',
      path: () => `/api/airlines/${need('airlineId')}/logo`,
      file: png(),
      expect: [200, 201],
      check: (r) => all([/logo/i.test(JSON.stringify(r.body)), 'no logo URL']),
    });
    add({
      requirement: 'GEN-08',
      name: 'non-image rejected',
      as: 'user',
      method: 'POST',
      path: () => `/api/posts/${need('post')}/images`,
      file: {
        field: 'file',
        data: Buffer.from('hello'),
        filename: 'a.txt',
        contentType: 'text/plain',
      },
      expect: 400,
    });
    add({
      requirement: 'GEN-08',
      name: 'over 5 MB rejected',
      as: 'user',
      method: 'POST',
      path: () => `/api/posts/${need('post')}/images`,
      file: {
        ...png(),
        data: Buffer.concat([
          imageBytes('png'),
          Buffer.alloc(5 * 1024 * 1024 + 10),
        ]),
      },
      expect: [400, 413],
    });
    add({
      requirement: 'GEN-09',
      name: 'report post',
      as: 'otherUser',
      method: 'POST',
      path: '/api/reports',
      body: () => ({
        targetType: 'post',
        targetId: need('post'),
        reason: 'Spam',
      }),
      expect: 201,
      check: (r) => {
        W.report = idOf(r.body) ?? '';
        return null;
      },
    });
    add({
      requirement: 'GEN-09',
      name: 'second report rejected',
      as: 'otherUser',
      method: 'POST',
      path: '/api/reports',
      body: () => ({
        targetType: 'post',
        targetId: need('post'),
        reason: 'Again',
      }),
      expect: 409,
    });
    add({
      requirement: 'GEN-10',
      name: 'open reports',
      as: 'admin',
      method: 'GET',
      path: '/api/admin/reports',
      expect: 200,
      check: (r) => all([listHas(r.body, W.report ?? ''), 'report not listed']),
    });
    add({
      requirement: 'GEN-10',
      name: 'dismiss report',
      as: 'admin',
      method: 'PATCH',
      path: () => `/api/admin/reports/${need('report')}`,
      body: { action: 'dismiss' },
      expect: 200,
    });
    add({
      requirement: 'GEN-10',
      name: 'hide content',
      as: 'admin',
      method: 'PATCH',
      path: () => `/api/admin/content/post/${need('otherPost')}/hide`,
      expect: [200, 204],
      check: async () => {
        const p = await as('guest', 'GET', `/api/posts/${need('otherPost')}`);
        const own = await as(
          'otherUser',
          'GET',
          `/api/posts/${need('otherPost')}`,
        );
        return all(
          [p.status === 404, `hidden post answers ${p.status} to guests`],
          [
            own.status === 200,
            `hidden post answers ${own.status} to its author`,
          ],
        );
      },
    });
    add({
      requirement: 'GEN-11',
      name: 'lifecycle states',
      as: 'user',
      method: 'GET',
      path: () => fb('b2'),
      expect: 200,
      check: async (r) => {
        const r3 = await as('user', 'GET', hb('r3'));
        return all(
          [get(r.body, 'status') === 'cancelled', 'cancelled booking'],
          [
            get(r3.body, 'status') === 'completed',
            `R3 ${String(get(r3.body, 'status'))}`,
          ],
        );
      },
    });
    add({
      requirement: 'GEN-11',
      name: 'cancel a pending booking rejected',
      as: 'user',
      method: 'POST',
      path: () => `${fb('b5')}/cancel`,
      body: {},
      expect: 409,
    });
    add({
      requirement: 'GEN-12',
      name: 'countries',
      as: 'guest',
      method: 'GET',
      path: '/api/countries',
      expect: 200,
      check: (r) => all([items(r.body).length > 0, 'empty']),
    });
    add({
      requirement: 'GEN-12',
      name: 'cities',
      as: 'guest',
      method: 'GET',
      path: '/api/cities',
      expect: 200,
      check: (r) => all([items(r.body).length > 0, 'empty']),
    });
    add({
      requirement: 'GEN-12',
      name: 'currencies',
      as: 'guest',
      method: 'GET',
      path: '/api/currencies',
      expect: 200,
      check: (r) => all([items(r.body).length > 0, 'empty']),
    });
    add({
      requirement: 'GEN-13',
      name: 'backend validates without a frontend',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/register',
      body: {
        name: 'X',
        email: `g13.${randomUUID()}@example.com`,
        password: '12345678',
        acceptTerms: true,
      },
      expect: 400,
    });
    add({
      requirement: 'GEN-13',
      name: 'password stored as salted hash',
      as: 'guest',
      method: 'POST',
      path: '/api/auth/login',
      expect: 200,
      run: () => login(actor('otherUser').email, DEMO_PASSWORD),
      check: async () => {
        const u = await app.t.connection
          .collection('users')
          .findOne({ email: actor('otherUser').email });
        const text = JSON.stringify(u ?? {});
        return all(
          [!text.includes(DEMO_PASSWORD), 'plain password stored'],
          [/\$2[aby]\$|\$argon2/.test(text), 'no bcrypt/argon2 hash'],
        );
      },
    });
    return P;
  }

  /** Values for path params when a guard probe needs them. */
  function paramValue(
    name: string,
    enumValues: unknown[] | undefined,
    bad?: string,
  ): string {
    if (name === bad) return 'abc';
    if (enumValues?.length) return String(enumValues[0]);
    if (name === 'tag') return 'audit';
    return NONE_ID;
  }

  interface DocOp {
    method: Method;
    path: string;
    params: { name: string; enum?: unknown[] }[];
    body: { required: string[]; json: boolean } | null;
    meta: RouteMeta | undefined;
  }
  function docOps(): DocOp[] {
    const out: DocOp[] = [];
    const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;
    const deref = (s: unknown): unknown => {
      const ref = str(get(s, '$ref'));
      return ref ? schemas[ref.split('/').pop() ?? ''] : s;
    };
    for (const [path, item] of Object.entries(doc.paths)) {
      if (path === '/api/health' || path.startsWith('/api/docs')) continue;
      for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const op = (item as Record<string, unknown>)[verb];
        if (!op) continue;
        const params = arr(get(op, 'parameters'))
          .filter((p) => get(p, 'in') === 'path')
          .map((p) => ({
            name: str(get(p, 'name')) ?? '',
            enum: arr(get(deref(get(p, 'schema')), 'enum')),
          }));
        const content = get(op, 'requestBody.content');
        const json = get(content, 'application/json.schema');
        const body =
          content === undefined
            ? null
            : json === undefined
              ? { required: [], json: false }
              : {
                  required: arr(get(deref(json), 'required')).map(String),
                  json: true,
                };
        const method = verb.toUpperCase() as Method;
        out.push({
          method,
          path,
          params,
          body,
          meta: meta.get(`${method} ${path}`),
        });
      }
    }
    return out;
  }

  /** Which actor holds which role, from /auth/me. */
  function roleActor(roles: string[], wrong: boolean): Who {
    const order: Who[] = ['user', 'hotelMod', 'airlineMod', 'admin'];
    const found = order.find((w) =>
      wrong
        ? !roles.includes(W[`${w}Role`] ?? '')
        : roles.includes(W[`${w}Role`] ?? ''),
    );
    return found ?? 'user';
  }

  function guardProbes(): { probes: Probe[]; notes: string[] } {
    const probes: Probe[] = [];
    const notes: string[] = [];
    const isId = (n: string) => n === 'id' || n.endsWith('Id');
    for (const op of docOps()) {
      const fill = (bad?: string) =>
        op.path.replace(/\{(\w+)\}/g, (_, n: string) =>
          paramValue(n, op.params.find((p) => p.name === n)?.enum, bad),
        );
      const key = `${op.method} ${op.path}`;
      if (!op.meta) {
        notes.push(`${key}: no controller metadata, guards skipped`);
        continue;
      }
      const allowed: Who = op.meta.isPublic
        ? 'guest'
        : op.meta.roles.length
          ? roleActor(op.meta.roles, false)
          : 'user';
      if (op.path !== '/api/payments/webhook') {
        // A refresh without a refresh cookie is a 401 by design, public or not.
        const publicNo401 = op.meta.isPublic && op.path !== '/api/auth/refresh';
        probes.push({
          requirement: 'GUARD:G-auth',
          name: publicNo401
            ? 'public without cookie is not 401'
            : 'protected without cookie is 401',
          as: 'guest',
          method: op.method,
          path: fill(),
          body: op.body?.json ? {} : undefined,
          expect: publicNo401 ? { not: 401 } : 401,
          check: (r) =>
            r.status === 401
              ? all([
                  [
                    ErrorCode.NotAuthenticated,
                    ErrorCode.SessionExpired,
                    ErrorCode.TokenExpired,
                  ].includes(String(get(r.body, 'code')) as never),
                  `code ${String(get(r.body, 'code'))}`,
                ])
              : null,
        });
      }
      if (op.meta.roles.length && !op.meta.isPublic) {
        const wrong = roleActor(op.meta.roles, true);
        if (!op.meta.roles.includes(W[`${wrong}Role`] ?? '')) {
          probes.push({
            requirement: 'GUARD:G-role',
            name: `wrong role (${W[`${wrong}Role`] ?? wrong}) for ${op.meta.roles.join('|')}`,
            as: wrong,
            method: op.method,
            path: fill(),
            body: op.body?.json ? {} : undefined,
            expect: [403, 404],
            check: (r) =>
              r.status === 403
                ? all([
                    get(r.body, 'code') === ErrorCode.ForbiddenRole,
                    `code ${String(get(r.body, 'code'))}`,
                  ])
                : null,
          });
        }
      }
      if (op.path === '/api/payments/webhook') continue;
      for (const p of op.params.filter((x) => isId(x.name))) {
        probes.push({
          requirement: 'GUARD:G-id',
          name: `${p.name}=abc`,
          as: allowed,
          method: op.method,
          path: fill(p.name),
          body: op.body?.json ? {} : undefined,
          expect: 400,
          check: (r) =>
            all([
              get(r.body, 'code') === ErrorCode.ValidationFailed,
              `code ${String(get(r.body, 'code'))}`,
            ]),
        });
      }
      if (op.body) {
        if (!op.body.json)
          notes.push(`${key}: G-body skipped (multipart body)`);
        else if (op.body.required.length === 0)
          notes.push(`${key}: G-body skipped (all fields optional)`);
        else
          probes.push({
            requirement: 'GUARD:G-body',
            name: `empty body (needs ${op.body.required.join(',')})`,
            as: allowed,
            method: op.method,
            path: fill(),
            body: {},
            expect: 400,
            check: (r) =>
              all([
                get(r.body, 'code') === ErrorCode.ValidationFailed,
                `code ${String(get(r.body, 'code'))}`,
              ]),
          });
      }
    }
    return { probes, notes };
  }

  async function runProbe(p: Probe): Promise<Row> {
    const row: Row = {
      requirement: p.requirement,
      probe: p.name,
      method: p.method,
      path: '?',
      as: p.as,
      expected: p.expect,
      got: null,
      code: null,
      message: null,
      ok: false,
    };
    try {
      row.path = await resolve(p.path);
      let res: Res;
      if (p.run) res = await p.run();
      else {
        const cookie = p.cookie
          ? p.cookie()
          : p.as === 'guest'
            ? undefined
            : actor(p.as).cookie;
        res = await send(
          cookie,
          p.method,
          row.path,
          p.body === undefined ? undefined : await resolve(p.body),
          p.file,
        );
      }
      row.got = res.status;
      row.code = str(get(res.body, 'code')) ?? null;
      const problems: string[] = [];
      if (res.status >= 500) problems.push(`server error ${res.status}`);
      if (res.status >= 400) {
        if (!String(res.headers['content-type']).includes('json'))
          problems.push('non-JSON error body');
        else if (row.code === null) problems.push(`${res.status} without code`);
      }
      if (!matches(p.expect, res.status))
        problems.push(
          `expected ${JSON.stringify(p.expect)}, got ${res.status}`,
        );
      else if (p.check) {
        const msg = await p.check(res);
        if (msg) problems.push(msg);
      }
      row.ok = problems.length === 0;
      row.message = problems.length
        ? `${problems.join('; ')}${res.status >= 400 ? ` | ${String(get(res.body, 'message'))}` : ''}`
        : null;
    } catch (error) {
      row.message = error instanceof Error ? error.message : String(error);
    }
    return row;
  }

  it('every mandatory requirement works through the API', async () => {
    for (const p of requirementProbes()) rows.push(await runProbe(p));
    const { probes, notes } = guardProbes();
    for (const p of probes) rows.push(await runProbe(p));
    writeOut('smoke.json', rows);
    writeOut('smoke-notes.json', notes);

    const byReq = new Map<string, { ok: number; bad: number }>();
    for (const r of rows) {
      const k = byReq.get(r.requirement) ?? { ok: 0, bad: 0 };
      if (r.ok) k.ok += 1;
      else k.bad += 1;
      byReq.set(r.requirement, k);
    }
    for (const c of CATALOG.filter((e) => e.kind === 'api'))
      if (!byReq.has(c.id)) byReq.set(c.id, { ok: 0, bad: 0 });
    for (const [req, k] of byReq)
      console.log(
        `${k.bad ? 'FAIL' : 'ok  '} ${req}: ${k.ok} ok, ${k.bad} failed`,
      );

    const failures = rows.filter((r) => !r.ok);
    expect(failures).toEqual([]);
  });
});
