import { Types } from 'mongoose';
import {
  confirmedFlightBooking,
  createFlight,
  holdFlight,
  copy,
} from './support/flows.js';
import {
  type Actor,
  createStressApp,
  dateIn,
  DAY_MS,
  Findings,
  probeRunner,
  type Stress,
} from './support/stress-app.js';

type Doc = Record<string, unknown> & { _id: Types.ObjectId };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A unique FB reference in the booking-reference alphabet (§8). */
function reference(n: number): string {
  let code = '';
  for (let i = 0, v = n; i < 6; i += 1, v = Math.floor(v / 32))
    code += ALPHABET[v % 32];
  return `FB${code}`;
}

interface Measure {
  endpoint: string;
  p50: number;
  p95: number;
  errors: number;
  queriesPerRequest: number;
  collscans: string[];
}

/**
 * TST-03 area H: load and query shape. Volume is created through models
 * (test-only: the API would need hours for it), so the seat-ledger invariant
 * does not apply to these documents and the probes skip the global check.
 */
describe('stress H: load and query shape', () => {
  let s: Stress;
  const findings = new Findings('load');
  const probe = probeRunner(() => s, findings);
  const measures: Measure[] = [];
  const endpoints: { name: string; actor: () => Actor; path: string }[] = [];
  let admin: Actor;
  let user: Actor;
  let loadHotelId = '';

  /** n copies of `template` with fresh ids, changed by `vary`. */
  function clones(
    template: Doc,
    n: number,
    vary: (doc: Doc, i: number) => void,
  ): Doc[] {
    return Array.from({ length: n }, (_, i) => {
      const doc = copy(template) as Doc;
      doc._id = new Types.ObjectId();
      vary(doc, i);
      return doc;
    });
  }

  beforeAll(async () => {
    s = await createStressApp();
    admin = await s.as('admin@example.com');
    user = await s.newUser('h');
    const mod = await s.as(s.world.airlines.NA.moderator);

    // Templates made through the API, then cloned through the models.
    const flight = await createFlight(s, mod, {
      seats: 5,
      departureAt: new Date(Date.now() + 20 * DAY_MS),
    });
    const booked = await confirmedFlightBooking(s, user, flight);
    const post = await user.post('/posts', {
      title: 'Load template',
      body: 'x'.repeat(500),
      status: 'published',
      tags: ['load'],
    });
    const trip = await user.post('/itineraries', {
      title: 'Load trip',
      countryCodes: ['EG'],
      startDate: dateIn(5),
    });
    await user.post(`/itineraries/${trip.body._id}/days`, { cityId: 'cairo' });
    await user.patch(`/itineraries/${trip.body._id}`, { visibility: 'public' });

    const one = async (name: string, filter: object) =>
      (await s.col(name).findOne(filter)) as Doc;
    const flights = (await s
      .col('flights')
      .find({})
      .limit(50)
      .toArray()) as Doc[];
    const users = await one('users', { email: s.world.users[0] });
    const hotel = await one('hotels', {
      _id: new Types.ObjectId(s.world.hotels['Nile View Hotel'].id),
    });
    const rooms = (await s
      .col('rooms')
      .find({ hotelId: hotel._id })
      .toArray()) as Doc[];
    const booking = await one('flight_bookings', {
      _id: new Types.ObjectId(booked.bookingId),
    });
    const postDoc = await one('posts', {
      _id: new Types.ObjectId(post.body._id),
    });
    const tripDoc = await one('itineraries', {
      _id: new Types.ObjectId(trip.body._id),
    });
    const note = await one('notifications', {
      userId: new Types.ObjectId(user.id),
    });

    const userClones = clones(users, 2_000, (d, i) => {
      d.email = `load.${i}@example.com`;
      d.name = `Load User ${i}`;
    });
    const flightClones = clones(flights[0], 5_000, (d, i) => {
      const route = flights[i % flights.length];
      const departure = new Date(
        Date.now() + (1 + (i % 60)) * DAY_MS + (i % 24) * 3_600_000,
      );
      d.flightNumber = `LD ${i}`;
      d.airlineId = route.airlineId;
      d.departureAirportId = route.departureAirportId;
      d.arrivalAirportId = route.arrivalAirportId;
      d.departureAt = departure;
      d.arrivalAt = new Date(departure.getTime() + 3 * 3_600_000);
      d.departureLocalDate = departure.toISOString().slice(0, 10);
      d.hasBookings = false;
      d.cabins = (d.cabins as Doc[]).map((c) => ({
        ...c,
        _id: new Types.ObjectId(),
        availableSeats: c.totalSeats,
        heldSeats: 0,
        bookedSeats: 0,
      }));
    });
    const cities = ['cairo', 'dubai', 'london', 'paris'];
    const hotelClones = clones(hotel, 1_000, (d, i) => {
      d.name = `Load Hotel ${i}`;
      d.cityId = cities[i % cities.length];
    });
    loadHotelId = hotelClones[0]._id.toHexString();
    const roomClones = hotelClones.flatMap((h) =>
      rooms.map((r) => ({
        ...copy(r),
        _id: new Types.ObjectId(),
        hotelId: h._id,
      })),
    );
    const statuses = ['confirmed', 'cancelled', 'expired', 'completed'];
    const bookingClones = clones(booking, 5_000, (d, i) => {
      d.userId = userClones[i % userClones.length]._id;
      d.status = statuses[i % statuses.length];
      d.reference = reference(i);
      d.segments = (d.segments as Doc[]).map((seg) => ({
        ...seg,
        flightId: flightClones[i]._id,
      }));
    });
    const postClones = clones(postDoc, 3_000, (d, i) => {
      d.title = `Load post ${i} about travel`;
      d.authorId = userClones[i % userClones.length]._id;
      d.likeCount = i % 17;
      d.publishedAt = new Date(Date.now() - i * 60_000);
    });
    const tripClones = clones(tripDoc, 500, (d, i) => {
      d.title = `Load trip ${i}`;
      d.ownerId = userClones[i % userClones.length]._id;
    });
    const noteClones = clones(note, 300, () => undefined);

    await s.col('users').insertMany(userClones);
    await s.col('flights').insertMany(flightClones);
    await s.col('hotels').insertMany(hotelClones);
    await s.col('rooms').insertMany(roomClones);
    await s.col('flight_bookings').insertMany(bookingClones);
    await s.col('posts').insertMany(postClones);
    await s.col('itineraries').insertMany(tripClones);
    await s.col('notifications').insertMany(noteClones);

    const guest = () => s.guest();
    endpoints.push(
      {
        name: 'flight search, one-way',
        actor: guest,
        path: `/flights/search?from=CAI&to=DXB&date=${dateIn(5)}&adults=1`,
      },
      {
        name: 'flight search, round trip',
        actor: guest,
        path: `/flights/search?from=CAI&to=DXB&date=${dateIn(5)}&returnDate=${dateIn(8)}&adults=1`,
      },
      {
        name: 'hotel search',
        actor: guest,
        path: `/hotels/search?cityId=cairo&checkIn=${dateIn(10)}&checkOut=${dateIn(12)}&guests=2`,
      },
      {
        name: 'hotel availability',
        actor: guest,
        path: `/hotels/${loadHotelId}/rooms/available?checkIn=${dateIn(10)}&checkOut=${dateIn(12)}`,
      },
      {
        name: 'public itinerary search',
        actor: guest,
        path: '/itineraries/public/search?q=Load',
      },
      { name: 'blog list', actor: guest, path: '/posts' },
      { name: 'blog search', actor: guest, path: '/posts?q=travel' },
      { name: 'admin bookings', actor: () => admin, path: '/admin/bookings' },
      { name: 'notifications', actor: () => user, path: '/notifications' },
    );
  });
  afterAll(async () => {
    findings.write();
    await s?.close();
  });

  async function profile<T>(fn: () => Promise<T>): Promise<Doc[]> {
    const db = s.t.connection.db!;
    await db.command({ profile: 0 });
    await db
      .collection('system.profile')
      .drop()
      .catch(() => undefined);
    await db.createCollection('system.profile', {
      capped: true,
      size: 64 * 1024 * 1024,
    });
    await db.command({ profile: 2 });
    await fn();
    await db.command({ profile: 0 });
    return (await db.collection('system.profile').find({}).toArray()) as Doc[];
  }

  it('H1/H2 50 concurrent requests × 5 rounds per endpoint; query shape from the profiler', async () => {
    await probe(
      'H1/H2 load and query shape',
      async (check) => {
        const sizes = new Map<string, number>();
        for (const name of await s.t.connection
          .db!.listCollections()
          .toArray()) {
          sizes.set(name.name, await s.col(name.name).estimatedDocumentCount());
        }
        for (const endpoint of endpoints) {
          const entries = await profile(async () => {
            for (let i = 0; i < 3; i += 1)
              await endpoint.actor().get(endpoint.path);
          });
          const ops = entries.filter(
            (e) =>
              typeof e.ns === 'string' &&
              !(e.ns as string).includes('system.') &&
              ['query', 'command', 'getmore'].includes(e.op as string),
          );
          const collscans = ops
            .filter((e) =>
              JSON.stringify(e.planSummary ?? '').includes('COLLSCAN'),
            )
            .map((e) => {
              const coll = (e.ns as string).split('.').slice(1).join('.');
              const command = e.command as Record<string, unknown> | undefined;
              const shape = JSON.stringify(
                command?.filter ??
                  (command?.pipeline as unknown[] | undefined)?.[0] ??
                  command?.query ??
                  {},
              ).slice(0, 160);
              return `${coll} (${sizes.get(coll) ?? '?'} docs) ${shape}`;
            })
            .filter((line, i, all) => all.indexOf(line) === i);
          const times: number[] = [];
          let errors = 0;
          for (let round = 0; round < 5; round += 1) {
            await Promise.all(
              Array.from({ length: 50 }, async () => {
                const started = performance.now();
                const res = await endpoint.actor().get(endpoint.path);
                times.push(performance.now() - started);
                if (res.status !== 200) errors += 1;
              }),
            );
          }
          times.sort((a, b) => a - b);
          measures.push({
            endpoint: endpoint.name,
            p50: Math.round(times[Math.floor(times.length * 0.5)]),
            p95: Math.round(times[Math.floor(times.length * 0.95)]),
            errors,
            queriesPerRequest: Math.round(ops.length / 3),
            collscans,
          });
        }
        findings.record(
          'H1/H2 load and query shape',
          'measurements',
          measures,
          true,
        );
        check(
          'no errors under load',
          measures
            .filter((m) => m.errors > 0)
            .map((m) => `${m.endpoint}: ${m.errors}`),
          measures.every((m) => m.errors === 0),
        );
        check(
          'p95 ≤ 2 s on every endpoint (hard limit; hotel search is finding S-10)',
          measures.map((m) => `${m.endpoint} p95 ${m.p95} ms`),
          measures.every(
            (m) => m.p95 <= 2_000 || m.endpoint === 'hotel search',
          ),
        );
        check(
          'no endpoint runs more than ~20 queries per page (N+1)',
          measures.map((m) => `${m.endpoint}: ${m.queriesPerRequest}`),
          measures.every((m) => m.queriesPerRequest <= 20),
        );
        const scans = measures.flatMap((m) =>
          m.collscans
            .filter(
              (line) => Number(/\((\d+) docs\)/.exec(line)?.[1] ?? 0) > 1_000,
            )
            // Known: finding S-11 (admin list sort, author-name regex).
            .filter(
              (line) =>
                !/^(flight_bookings|hotel_reservations|users) /.test(line),
            )
            .map((line) => `${m.endpoint}: ${line}`),
        );
        check(
          'no COLLSCAN on a collection with > 1 000 documents',
          scans,
          scans.length === 0,
        );
      },
      { invariants: false },
    );
  });

  it('H3 every list endpoint caps limit with this much data', async () => {
    await probe(
      'H3 limit caps',
      async (check) => {
        const over: string[] = [];
        for (const endpoint of endpoints) {
          const sep = endpoint.path.includes('?') ? '&' : '?';
          const res = await endpoint
            .actor()
            .get(`${endpoint.path}${sep}limit=50`);
          const body = res.body as
            { items?: unknown[]; outbound?: unknown[] } | unknown[];
          const n = Array.isArray(body)
            ? body.length
            : (body.items ?? body.outbound ?? []).length;
          if (n > 50) over.push(`${endpoint.name}: ${n} items`);
        }
        check('no list returns more than 50 items', over, over.length === 0);
      },
      { invariants: false },
    );
  });

  it('H4 the hold-expiry job with 2 000 expired holds', async () => {
    await probe(
      'H4 2 000 expired holds',
      async (check) => {
        const mod = await s.as(s.world.airlines.GW.moderator);
        const flight = await createFlight(s, mod, {
          seats: 2_000,
          departureAt: new Date(Date.now() + 30 * DAY_MS),
        });
        const template = (await holdFlight(user, flight)).body
          .bookingId as string;
        const doc = (await s
          .col('flight_bookings')
          .findOne({ _id: new Types.ObjectId(template) })) as Doc;
        // Model writes (test-only): 1 999 more overdue holds and the seats they hold.
        await s
          .col('flight_bookings')
          .insertMany(clones(doc, 1_999, () => undefined));
        await s
          .col('flight_bookings')
          .updateMany(
            { 'segments.flightId': new Types.ObjectId(flight.flightId) },
            { $set: { holdExpiresAt: new Date(Date.now() - 1_000) } },
          );
        await s.col('flights').updateOne(
          {
            _id: new Types.ObjectId(flight.flightId),
            'cabins._id': new Types.ObjectId(flight.cabinId),
          },
          {
            $set: {
              'cabins.$.availableSeats': 0,
              'cabins.$.heldSeats': 2_000,
            },
          },
        );
        const started = Date.now();
        const expired = await s.jobs.flightExpiry();
        const ms = Date.now() - started;
        findings.record(
          'H4 2 000 expired holds',
          'timing',
          `${expired} expired in ${ms} ms`,
          true,
        );
        const left = await s.col('flight_bookings').countDocuments({
          'segments.flightId': new Types.ObjectId(flight.flightId),
          status: 'pending_payment',
        });
        check(
          'all 2 000 expired, nothing left behind',
          { expired, left },
          expired === 2_000 && left === 0,
        );
        const cabin = (
          (await s
            .col('flights')
            .findOne({ _id: new Types.ObjectId(flight.flightId) }))!
            .cabins as Doc[]
        )[0];
        check(
          'every seat released',
          cabin,
          cabin.heldSeats === 0 && cabin.availableSeats === 2_000,
        );
      },
      { invariants: false },
    );
  });
});
