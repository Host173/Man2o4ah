import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { TEST_JWT_ACCESS_SECRET } from '../support/test-config.js';
import { ROUTES, X } from './support/routes.js';
import {
  confirmedFlightBooking,
  confirmedHotelBooking,
  createFlight,
  createRoom,
} from './support/flows.js';
import {
  type Actor,
  createStressApp,
  dateIn,
  eventually,
  Findings,
  parallel,
  probeRunner,
  settle,
  statuses,
  type Stress,
} from './support/stress-app.js';

/** TST-03 area C: who can do what (ACC-04..19, ACC-11, GEN-13). */
describe('stress C: who can do what', () => {
  let s: Stress;
  const findings = new Findings('access');
  const probe = probeRunner(() => s, findings);
  const oid = (id: string) => new Types.ObjectId(id);

  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(async () => {
    findings.write();
    await s?.close();
  });

  function call(actor: Actor, method: string, path: string) {
    return actor.req(method as never, path).send({});
  }

  it('C1a no cookie → 401 on every non-public route', async () => {
    await probe('C1a no cookie', async (check) => {
      const wrong: string[] = [];
      for (const [method, path, access] of ROUTES) {
        if (access === 'pub') continue;
        const res = await call(s.guest(), method, path);
        if (res.status !== 401)
          wrong.push(`${method.toUpperCase()} ${path} → ${res.status}`);
      }
      check(
        'every protected route answers 401 without a cookie',
        wrong,
        wrong.length === 0,
      );
    });
  });

  it('C1b expired token, logout, suspension and password change end sessions', async () => {
    await probe('C1b session revocation', async (check) => {
      const user = await s.newUser('c1');
      const jwt = new JwtService({ secret: TEST_JWT_ACCESS_SECRET });
      const access = /access_token=([^;]+)/.exec(user.cookie)![1];
      const claims = jwt.decode<Record<string, unknown>>(access);
      const expired = await jwt.signAsync({
        sub: claims.sub,
        role: claims.role,
        sid: claims.sid,
        exp: Math.floor(Date.now() / 1000) - 60,
      });
      const refresh = /refresh_token=([^;]+)/.exec(user.cookie)?.[1];
      const withExpired = await s.t
        .http()
        .get('/api/auth/me')
        .set('Cookie', `access_token=${expired}; refresh_token=${refresh}`);
      check(
        'an expired access token → 401 TOKEN_EXPIRED',
        `${withExpired.status} ${withExpired.body.code}`,
        withExpired.status === 401 && withExpired.body.code === 'TOKEN_EXPIRED',
      );
      const refreshed = await s.t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${refresh}`);
      const newAccess = /access_token=([^;]+)/.exec(
        String(refreshed.headers['set-cookie']),
      )?.[1];
      const me = await s.t
        .http()
        .get('/api/auth/me')
        .set('Cookie', `access_token=${newAccess}`);
      check(
        'then a refresh works (2xx; probe corrected: the API answers 204)',
        [refreshed.status, me.status],
        refreshed.status >= 200 && refreshed.status < 300 && me.status === 200,
      );

      const out = await user.post('/auth/logout', {});
      const after = await user.get('/auth/me');
      check(
        'after logout the old cookie → 401',
        [out.status, after.status],
        after.status === 401,
      );

      const victim = await s.newUser('c1-suspend');
      const admin = await s.as('admin@example.com');
      const suspended = await admin.patch(
        `/admin/accounts/${victim.id}/suspend`,
        {},
      );
      const old = await victim.get('/auth/me');
      check(
        "a suspended user's session no longer works (401)",
        [suspended.status, old.status],
        suspended.status < 300 && old.status === 401,
      );
      const login = await s
        .guest()
        .post('/auth/login', { email: victim.email, password: 'Demo12345' });
      check(
        "a suspended user can't log in (403 ACCOUNT_SUSPENDED)",
        `${login.status} ${login.body.code}`,
        login.status === 403 && login.body.code === 'ACCOUNT_SUSPENDED',
      );

      const changer = await s.newUser('c1-change');
      const second = await s.as(changer.email);
      const changed = await changer.patch('/auth/change-password', {
        currentPassword: 'Demo12345',
        newPassword: 'Changed123',
      });
      const [a, b] = await Promise.all([
        changer.get('/auth/me'),
        second.get('/auth/me'),
      ]);
      check(
        'a password change revokes every old session',
        [changed.status, a.status, b.status],
        changed.status === 204 && a.status === 401 && b.status === 401,
      );
    });
  });

  it('C2a role escalation: users and moderators on routes of other roles → 403', async () => {
    await probe('C2a role escalation', async (check) => {
      const actors: Record<string, Actor> = {
        user: await s.as(s.world.users[0]),
        amod: await s.as(s.world.airlines.NA.moderator),
        hmod: await s.as(s.world.hotels['Nile View Hotel'].moderator),
      };
      const wrong: string[] = [];
      for (const [method, path, access] of ROUTES) {
        for (const [who, actor] of Object.entries(actors)) {
          const allowed =
            access === 'pub' ||
            access === 'user' ||
            (access === 'USER' && who === 'user') ||
            access === who;
          if (allowed) continue;
          const res = await call(actor, method, path);
          if (res.status !== 403)
            wrong.push(
              `${who} ${method.toUpperCase()} ${path} → ${res.status}`,
            );
        }
      }
      check(
        "every call above the caller's role → 403",
        wrong,
        wrong.length === 0,
      );
    });
  });

  it('C2b moderator scope: airline A on airline B, hotel A on hotel B → 403/404, nothing changes', async () => {
    await probe('C2b moderator scope', async (check) => {
      const a = await s.as(s.world.airlines.NA.moderator);
      const bId = s.world.airlines.GW.id;
      const bFlight = await s.col('flights').findOne({ airlineId: oid(bId) });
      const fId = bFlight!._id.toHexString();
      const cId = bFlight!.cabins[0]._id.toHexString();
      const calls: [string, string, unknown][] = [
        ['patch', `/airlines/${bId}`, { name: 'Hijacked' }],
        [
          'put',
          `/airlines/${bId}/baggage-policy`,
          { extraBagPriceMinor: 1, maxExtraBagsPerPassenger: 9 },
        ],
        [
          'put',
          `/airlines/${bId}/cancellation-policy`,
          { tiers: [{ daysBefore: 0, refundPercent: 100 }] },
        ],
        ['get', `/airlines/${bId}/flights`, undefined],
        ['patch', `/flights/${fId}`, { departureLocal: '2030-01-01T10:00' }],
        [
          'post',
          `/flights/${fId}/cabins`,
          {
            cabinClass: 'first',
            totalSeats: 1,
            priceMinor: 1,
            freeBags: 0,
            maxBagWeightKg: 1,
          },
        ],
        ['patch', `/flights/${fId}/cabins/${cId}`, { priceMinor: 1 }],
        ['get', `/flights/${fId}/bookings`, undefined],
        ['get', `/flights/${fId}/passengers/export`, undefined],
        ['post', `/flights/${fId}/cancel`, {}],
      ];
      const wrong: string[] = [];
      for (const [method, path, body] of calls) {
        const res = await a.req(method as never, path).send(body as object);
        if (res.status !== 403 && res.status !== 404)
          wrong.push(`${method.toUpperCase()} ${path} → ${res.status}`);
      }
      const after = await s.col('flights').findOne({ _id: bFlight!._id });
      const airline = await s.col('airlines').findOne({ _id: oid(bId) });
      check("airline A can't touch airline B", wrong, wrong.length === 0);
      check(
        'airline B unchanged',
        [after?.status, airline?.name, after?.cabins.length],
        after?.status === 'scheduled' &&
          airline?.name === 'Gulf Wings' &&
          after?.cabins.length === bFlight!.cabins.length,
      );

      const h = await s.as(s.world.hotels['Nile View Hotel'].moderator);
      const other = s.world.hotels['Marina Bay Suites'].id;
      const room = await s.col('rooms').findOne({ hotelId: oid(other) });
      const rId = room!._id.toHexString();
      const hotelCalls: [string, string, unknown][] = [
        ['patch', `/hotels/${other}`, { name: 'Hijacked' }],
        [
          'put',
          `/hotels/${other}/policies`,
          {
            checkInTime: '01:00',
            checkOutTime: '02:00',
            cancellationPolicy: { tiers: [] },
          },
        ],
        ['get', `/hotels/${other}/rooms`, undefined],
        [
          'post',
          `/hotels/${other}/rooms`,
          {
            name: 'Evil',
            type: 'X',
            beds: 1,
            maxOccupancy: 1,
            pricePerNightMinor: 1,
          },
        ],
        ['patch', `/hotels/${other}/rooms/${rId}`, { pricePerNightMinor: 1 }],
        ['delete', `/hotels/${other}/rooms/${rId}`, undefined],
        [
          'post',
          `/hotels/${other}/rooms/${rId}/availability`,
          { fromDate: dateIn(200), toDate: dateIn(210) },
        ],
        [
          'patch',
          `/hotels/${other}/rooms/${rId}/availability`,
          { op: 'SET_RANGES', ranges: [] },
        ],
        [
          'get',
          `/hotels/${other}/availability?from=${dateIn(1)}&to=${dateIn(5)}`,
          undefined,
        ],
        ['get', `/hotels/${other}/reservations`, undefined],
      ];
      const hWrong: string[] = [];
      for (const [method, path, body] of hotelCalls) {
        const res = await h.req(method as never, path).send(body as object);
        if (res.status !== 403 && res.status !== 404)
          hWrong.push(`${method.toUpperCase()} ${path} → ${res.status}`);
      }
      const roomAfter = await s.col('rooms').findOne({ _id: room!._id });
      check("hotel A can't touch hotel B", hWrong, hWrong.length === 0);
      check(
        "hotel B's room unchanged",
        roomAfter?.pricePerNightMinor,
        roomAfter?.pricePerNightMinor === room!.pricePerNightMinor,
      );
    });
  });

  it("C3 someone else's data → 404 on every Own route; private itineraries stay private", async () => {
    await probe('C3 ownership (ACC-11)', async (check) => {
      const owner = await s.newUser('c3-owner');
      const other = await s.newUser('c3-other');
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, {
        seats: 5,
        departureAt: new Date(Date.now() + 40 * 86_400_000),
      });
      const fb = await confirmedFlightBooking(s, owner, flight);
      const second = await confirmedFlightBooking(s, owner, flight);
      await owner.post(`/flight-bookings/${second.bookingId}/cancel`, {});
      const refund = await eventually(() =>
        s.col('refunds').findOne({ bookingId: oid(second.bookingId) }),
      );
      const hotel = s.world.hotels['Thames Court'];
      const roomId = await createRoom(await s.as(hotel.moderator), hotel.id);
      const hb = await confirmedHotelBooking(
        s,
        owner,
        hotel.id,
        roomId,
        dateIn(30),
        dateIn(32),
      );
      const title = `Secret trip ${Date.now()}`;
      const it = await owner.post('/itineraries', {
        title,
        countryCodes: ['EG'],
        startDate: dateIn(10),
      });
      check('the private itinerary is created', it.status, it.status === 201);
      const itId = it.body._id as string;
      await settle(300);
      const note = await s
        .col('notifications')
        .findOne({ userId: oid(owner.id) });

      const calls: [string, string, unknown?][] = [
        ['get', `/flight-bookings/${fb.bookingId}`],
        ['get', `/flight-bookings/${fb.bookingId}/refund-preview`],
        ['get', `/flight-bookings/${fb.bookingId}/e-ticket`],
        ['post', `/flight-bookings/${fb.bookingId}/cancel`, {}],
        ['get', `/hotel-bookings/${hb.bookingId}`],
        ['get', `/hotel-bookings/${hb.bookingId}/refund-preview`],
        ['post', `/hotel-bookings/${hb.bookingId}/cancel`, {}],
        ['get', `/bookings/flight/${fb.bookingId}/policies`],
        [
          'post',
          `/bookings/flight/${fb.bookingId}/accept-policies`,
          { accepted: true },
        ],
        [
          'post',
          '/payments',
          { bookingType: 'flight', bookingId: fb.bookingId },
        ],
        ['get', `/payments/${fb.paymentId}`],
        ['post', `/payments/${fb.paymentId}/retry`, {}],
        ['get', `/refunds/${refund!._id.toHexString()}`],
        ['get', `/itineraries/${itId}`],
        ['patch', `/itineraries/${itId}`, { title: 'Mine now' }],
        ['delete', `/itineraries/${itId}`],
        ['post', `/itineraries/${itId}/days`, { cityId: 'cairo' }],
        ['get', `/itineraries/${itId}/budget-summary`],
        ['post', `/itineraries/${itId}/clone`, {}],
        ['patch', `/notifications/${note!._id.toHexString()}/read`, {}],
      ];
      const wrong: string[] = [];
      for (const [method, path, body] of calls) {
        const res = await other.req(method as never, path).send(body as object);
        if (res.status !== 404)
          wrong.push(
            `${method.toUpperCase()} ${path} → ${res.status} ${res.body?.code ?? ''}`,
          );
      }
      check(
        'every Own route answers 404 to another user',
        wrong,
        wrong.length === 0,
      );
      const still = await s
        .col('flight_bookings')
        .findOne({ _id: oid(fb.bookingId) });
      const itAfter = await s.col('itineraries').findOne({ _id: oid(itId) });
      const noteAfter = await s
        .col('notifications')
        .findOne({ _id: note!._id });
      check(
        'nothing of the owner changed',
        [still?.status, itAfter?.title, noteAfter?.readAt ?? null],
        still?.status === 'confirmed' &&
          itAfter?.title === title &&
          !noteAfter?.readAt,
      );
      const search = await s
        .guest()
        .get(`/itineraries/public/search?q=${encodeURIComponent(title)}`);
      check(
        'a private itinerary is invisible in public search',
        search.body,
        search.status === 200 && !JSON.stringify(search.body).includes(itId),
      );
      const publicGet = await s.guest().get(`/itineraries/public/${itId}`);
      check(
        'GET /itineraries/public/:id of a private itinerary → 404',
        publicGet.status,
        publicGet.status === 404,
      );
    });
  });

  it('C4 mass assignment: forbidden fields → 400 and nothing changes', async () => {
    await probe('C4 mass assignment', async (check) => {
      const user = await s.newUser('c4');
      const amod = await s.as(s.world.airlines.NA.moderator);
      const hmod = await s.as(s.world.hotels['Nile View Hotel'].moderator);
      const hotelId = s.world.hotels['Nile View Hotel'].id;
      const mod = amod;
      const flight = await createFlight(s, mod, { seats: 5 });
      const fields = {
        role: 'admin',
        status: 'active',
        userId: X,
        providerId: X,
        totalMinor: 1,
        price: 1,
        isActive: false,
        mustChangePassword: false,
        createdAt: '2000-01-01',
      };
      const attempts: [Actor, string, string, Record<string, unknown>][] = [];
      for (const [key, value] of Object.entries(fields)) {
        attempts.push(
          [user, 'patch', '/users/me', { name: 'Ok', [key]: value }],
          [
            s.guest(),
            'post',
            '/auth/register',
            {
              name: 'X',
              email: `c4.${key}.${Date.now()}@example.com`,
              password: 'Demo12345',
              acceptTerms: true,
              [key]: value,
            },
          ],
          [
            user,
            'post',
            '/posts',
            { title: 'T', body: 'B', status: 'draft', [key]: value },
          ],
          [
            user,
            'post',
            '/flight-bookings/hold',
            {
              tripType: 'one_way',
              segments: [
                { flightId: flight.flightId, cabinId: flight.cabinId },
              ],
              passengers: [
                {
                  type: 'adult',
                  fullName: 'A',
                  dateOfBirth: '1990-01-01',
                  documentNumber: 'P123',
                  extraBagCount: 0,
                },
              ],
              [key]: value,
            },
          ],
          [
            user,
            'post',
            '/itineraries',
            {
              title: 'T',
              countryCodes: ['EG'],
              startDate: dateIn(5),
              [key]: value,
            },
          ],
          [
            amod,
            'post',
            `/flights/${flight.flightId}/cabins`,
            {
              cabinClass: 'business',
              totalSeats: 2,
              priceMinor: 5,
              freeBags: 0,
              maxBagWeightKg: 1,
              [key]: value,
            },
          ],
          [
            hmod,
            'patch',
            `/hotels/${hotelId}`,
            { description: 'x', [key]: value },
          ],
          [
            user,
            'post',
            '/reports',
            { targetType: 'post', targetId: X, reason: 'x', [key]: value },
          ],
        );
      }
      const wrong: string[] = [];
      for (const [actor, method, path, body] of attempts) {
        const res = await actor.req(method as never, path).send(body);
        if (res.status !== 400) {
          const extra = Object.keys(body).at(-1);
          wrong.push(
            `${method.toUpperCase()} ${path} +${extra} → ${res.status}`,
          );
        }
      }
      check(
        'every body with a forbidden field → 400',
        wrong,
        wrong.length === 0,
      );
      const me = await s.col('users').findOne({ _id: oid(user.id) });
      check(
        'the user is still a plain active user',
        [me?.role, me?.status],
        me?.role === 'user' && me?.status === 'active',
      );
      const hotel = await s.col('hotels').findOne({ _id: oid(hotelId) });
      check(
        'the hotel is still active',
        hotel?.isActive,
        hotel?.isActive === true,
      );
      const leaked = await s
        .col('users')
        .countDocuments({ email: /^c4\./, role: { $ne: 'user' } });
      check('no account registered with another role', leaked, leaked === 0);
    });
  });

  it('C5 injection in queries and bodies; regex-heavy searches', async () => {
    await probe('C5 injection', async (check) => {
      const admin = await s.as('admin@example.com');
      const queries = [
        '/posts?q[$ne]=x',
        '/posts?status[$gt]=',
        '/posts?page[$gt]=0',
        '/flights/search?from[$ne]=x&to=DXB&date=2030-01-01&adults=1',
        '/hotels/search?cityId[$ne]=x&checkIn=2030-01-01&checkOut=2030-01-02&guests=1',
        '/itineraries/public/search?q[$gt]=',
        '/flights/{"$ne":null}',
        '/posts/{"$ne":null}',
      ];
      const wrong: string[] = [];
      for (const path of queries) {
        const res = await s.guest().get(path);
        if (res.status !== 400 && res.status !== 404)
          wrong.push(`${path} → ${res.status}`);
      }
      const adminQ = await admin.get('/admin/accounts?status[$gt]=');
      if (adminQ.status !== 400)
        wrong.push(`/admin/accounts?status[$gt]= → ${adminQ.status}`);
      check(
        'operator-shaped query params → 400 (never a match)',
        wrong,
        wrong.length === 0,
      );

      const bodies = [
        { email: { $ne: null }, password: 'x' },
        { email: 'sara@example.com', password: { $ne: null } },
        { $where: 'return true', email: 'sara@example.com', password: 'x' },
      ];
      const loginCodes = [];
      for (const body of bodies)
        loginCodes.push((await s.guest().post('/auth/login', body)).status);
      check(
        'operator-shaped login bodies → 400',
        loginCodes,
        loginCodes.every((c) => c === 400),
      );

      const evil = [
        '.*.*.*.*.*.*.*.*.*.*',
        '(a+)+$',
        'a'.repeat(5_000),
        '(.*a){20}',
      ];
      const slow: string[] = [];
      for (const q of evil) {
        for (const path of [
          `/posts?q=${encodeURIComponent(q)}`,
          `/itineraries/public/search?q=${encodeURIComponent(q)}`,
        ]) {
          const started = Date.now();
          const res = await s.guest().get(path);
          const ms = Date.now() - started;
          if (res.status >= 500 || ms > 1_000)
            slow.push(`${path.slice(0, 60)} → ${res.status} in ${ms} ms`);
        }
        const started = Date.now();
        const res = await admin.get(
          `/admin/accounts?q=${encodeURIComponent(q)}`,
        );
        if (res.status >= 500 || Date.now() - started > 1_000)
          slow.push(`admin q=${q.slice(0, 20)} → ${res.status}`);
      }
      check(
        'regex-heavy searches answer < 1 s without 5xx',
        slow,
        slow.length === 0,
      );
      const literal = await s.guest().get('/posts?q=.*');
      check(
        '".*" is escaped (matches nothing literally)',
        literal.body?.total,
        literal.status === 200 && literal.body.total === 0,
      );
    });
  });

  it('C6 lockout: 5 wrong passwords in parallel lock once; the lock blocks the right one', async () => {
    await probe('C6 lockout (ACC-05)', async (check) => {
      const user = await s.newUser('c6');
      const wrong = await parallel(5, () =>
        s
          .guest()
          .post('/auth/login', { email: user.email, password: 'Wrong1234' }),
      );
      const codes = wrong.map((r) =>
        r.status === 'fulfilled'
          ? `${r.value.status}:${r.value.body.code}`
          : 'x',
      );
      check(
        'no 5xx',
        codes,
        statuses(wrong).every((c) => c > 0 && c < 500),
      );
      const doc = await s.col('users').findOne({ _id: oid(user.id) });
      check(
        'locked after 5 parallel failures',
        doc?.lockedUntil,
        doc?.lockedUntil instanceof Date && doc.lockedUntil > new Date(),
      );
      const right = await s
        .guest()
        .post('/auth/login', { email: user.email, password: 'Demo12345' });
      check(
        'the right password during the lock → 401 ACCOUNT_LOCKED',
        `${right.status} ${right.body.code}`,
        right.status === 401 && right.body.code === 'ACCOUNT_LOCKED',
      );
      // Model write (test-only): end the 15-minute lock now.
      await s
        .col('users')
        .updateOne(
          { _id: oid(user.id) },
          { $set: { lockedUntil: new Date(Date.now() - 1000) } },
        );
      const ok = await s
        .guest()
        .post('/auth/login', { email: user.email, password: 'Demo12345' });
      const after = await s.col('users').findOne({ _id: oid(user.id) });
      check(
        'after the lock a successful login works and resets the counter',
        [ok.status, after?.failedLoginAttempts],
        ok.status === 200 && after?.failedLoginAttempts === 0,
      );

      const many = await s.newUser('c6-many');
      const storm = await parallel(12, () =>
        s
          .guest()
          .post('/auth/login', { email: many.email, password: 'Wrong1234' }),
      );
      const stormCodes = storm.map((r) =>
        r.status === 'fulfilled' ? r.value.body.code : 'x',
      );
      const doc2 = await s.col('users').findOne({ _id: oid(many.id) });
      check(
        '12 parallel failures: locked, no 5xx, counter not negative',
        [stormCodes, doc2?.failedLoginAttempts],
        statuses(storm).every((c) => c > 0 && c < 500) &&
          doc2?.lockedUntil > new Date() &&
          doc2?.failedLoginAttempts >= 0,
      );
    });
  });

  it('records no unhandled rejection', () => {
    expect(s.unhandled).toEqual([]);
  });
});
