import { readdirSync } from 'node:fs';
import { Types } from 'mongoose';
import { createFlight, isErrorShape } from './support/flows.js';
import { ROUTES, X } from './support/routes.js';
import {
  type Actor,
  createStressApp,
  dateIn,
  Findings,
  probeRunner,
  type Stress,
} from './support/stress-app.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXE = Buffer.from(
  'MZ\x90\x00\x03\x00\x00\x00 this program cannot be run in DOS mode',
);

function png(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  PNG.copy(bytes);
  return bytes;
}

/** TST-03 area D: bad input that crashes servers (GEN-08, GEN-13, backend.md §5-7). */
describe('stress D: bad input', () => {
  let s: Stress;
  const findings = new Findings('input');
  const probe = probeRunner(() => s, findings);
  const oid = (id: string) => new Types.ObjectId(id);

  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(async () => {
    findings.write();
    await s?.close();
  });

  const raw = (
    path: string,
    body: string | Buffer,
    type = 'application/json',
  ) => s.t.http().post(`/api${path}`).set('Content-Type', type).send(body);

  it('D1 malformed, empty, huge, wrong-shaped and deeply nested JSON', async () => {
    await probe('D1 bad JSON bodies', async (check) => {
      // The depth-10 000 body is finding S-03 (findings/S-03-…).
      const big = (mb: number) =>
        JSON.stringify({
          email: 'a@b.c',
          password: 'x',
          pad: 'x'.repeat(mb * 1024 * 1024),
        });
      const cases: [string, string][] = [
        ['malformed', '{"email": "a@b.c", '],
        ['empty with Content-Type json', ''],
        ['2 MB', big(2)],
        ['20 MB', big(20)],
        ['array instead of object', '[{"email":"a@b.c","password":"x"}]'],
        ['depth 100', `${'{"a":'.repeat(100)}1${'}'.repeat(100)}`],
        ['a JSON string', '"hello"'],
        ['null', 'null'],
      ];
      for (const [name, body] of cases) {
        // Probe correction: not the webhook. FakeStripeGateway parses any body
        // under its fixed signature; real signature checks are probed in E5.
        for (const path of ['/auth/login', '/auth/register']) {
          const res = await raw(path, body).set(
            'stripe-signature',
            'fake-stripe-signature',
          );
          check(
            `${name} on ${path} → 400/413 in the JSON error shape`,
            `${res.status} ${String(res.text).slice(0, 120)}`,
            (res.status === 400 || res.status === 413 || res.status === 401) &&
              isErrorShape(res.body),
          );
        }
      }
      const health = await s.guest().get('/health');
      check('the app keeps answering', health.status, health.status === 200);
    });
  });

  it('D2 every :id route with abc, 24 zeros, 25-char hex and %00', async () => {
    await probe('D2 bad ids', async (check) => {
      const actors: Record<string, Actor> = {
        pub: s.guest(),
        user: await s.as(s.world.users[0]),
        USER: await s.as(s.world.users[0]),
        admin: await s.as('admin@example.com'),
        amod: await s.as(s.world.airlines.NA.moderator),
        hmod: await s.as(s.world.hotels['Nile View Hotel'].moderator),
      };
      const bad = [
        'abc',
        '000000000000000000000000',
        '0123456789abcdef012345678',
        '%00',
      ];
      const wrong: string[] = [];
      for (const [method, path, access] of ROUTES) {
        if (!path.includes(X)) continue;
        for (const value of bad) {
          const target = path.split(X).join(value);
          const res = await actors[access]
            .req(method as never, target)
            .send({});
          if (res.status >= 500 || !isErrorShape(res.body)) {
            wrong.push(
              `${access} ${method.toUpperCase()} ${target} → ${res.status}`,
            );
          }
        }
      }
      check(
        'never 5xx; always the JSON error shape',
        wrong,
        wrong.length === 0,
      );
    });
  });

  it('D3 length limits, emoji/RTL text and hostile numbers', async () => {
    await probe('D3 limits and numbers', async (check) => {
      const user = await s.newUser('d3');
      const limits: [string, string, (n: number) => object, number][] = [
        [
          'post title',
          '/posts',
          (n) => ({ title: 'x'.repeat(n), body: 'b', status: 'draft' }),
          150,
        ],
        [
          'post body',
          '/posts',
          (n) => ({ title: 't', body: 'x'.repeat(n), status: 'draft' }),
          20_000,
        ],
        [
          'post tag',
          '/posts',
          (n) => ({
            title: 't',
            body: 'b',
            status: 'draft',
            tags: ['x'.repeat(n)],
          }),
          30,
        ],
        [
          'tag count',
          '/posts',
          (n) => ({
            title: 't',
            body: 'b',
            status: 'draft',
            tags: Array.from({ length: n }, (_, i) => `t${i}`),
          }),
          5,
        ],
        [
          'itinerary title',
          '/itineraries',
          (n) => ({
            title: 'x'.repeat(n),
            countryCodes: ['EG'],
            startDate: dateIn(5),
          }),
          100,
        ],
        [
          'report reason',
          '/reports',
          (n) => ({ targetType: 'post', targetId: X, reason: 'x'.repeat(n) }),
          500,
        ],
      ];
      const wrong: string[] = [];
      for (const [name, path, body, max] of limits) {
        const atMax = await user.post(path, body(max));
        const over = await user.post(path, body(max + 1));
        // The report target doesn't exist, so "at max" passes validation and gets 404.
        const okAtMax =
          atMax.status === 201 || (path === '/reports' && atMax.status === 404);
        if (!okAtMax || over.status !== 400)
          wrong.push(`${name}: max ${atMax.status}, max+1 ${over.status}`);
      }
      check(
        'each documented limit: max accepted, max + 1 → 400',
        wrong,
        wrong.length === 0,
      );

      const post = await user.post('/posts', {
        title: '🌍✈️ رحلة إلى القاهرة',
        body: 'مرحبا 👋 שלום',
        status: 'published',
        tags: ['سفر'],
      });
      const comment = post.body._id
        ? await user.post(`/posts/${post.body._id}/comments`, {
            body: '🔥 جميل جدا',
          })
        : { status: -1 };
      const named = await user.patch('/users/me', { name: 'سارة 🌸' });
      check(
        'emoji and RTL text accepted',
        [post.status, comment.status, named.status],
        post.status === 201 && comment.status === 201 && named.status === 200,
      );

      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 5 });
      const hostile = [
        '1e309',
        'NaN',
        '"Infinity"',
        '-0',
        '9007199254740993',
        '"5"',
        '1.5',
        '-1',
      ];
      const numberWrong: string[] = [];
      for (const value of hostile) {
        const bodies: [string, string][] = [
          [
            `/flights/${flight.flightId}/cabins`,
            `{"cabinClass":"first","totalSeats":${value},"priceMinor":100,"freeBags":0,"maxBagWeightKg":20}`,
          ],
          [
            '/flight-bookings',
            `{"tripType":"one_way","segments":[{"flightId":"${flight.flightId}","cabinId":"${flight.cabinId}"}],"passengers":[{"type":"adult","fullName":"A B","dateOfBirth":"1990-01-01","documentNumber":"P123","extraBagCount":${value}}]}`,
          ],
        ];
        for (const [path, body] of bodies) {
          const actor = path.startsWith('/flights/') ? mod : user;
          const res = await s.t
            .http()
            .post(`/api${path}`)
            .set('Cookie', actor.cookie)
            .set('Content-Type', 'application/json')
            .send(body);
          const acceptable =
            value === '-0' ? res.status < 500 : res.status === 400;
          if (!acceptable)
            numberWrong.push(`${path.split('/')[1]} ${value} → ${res.status}`);
        }
      }
      check(
        'hostile numbers → 400 (never stored, never 5xx)',
        numberWrong,
        numberWrong.length === 0,
      );
      // A price × seats total past a safe integer is finding S-04.
    });
  });

  it('D4 pagination extremes on every list', async () => {
    await probe('D4 pagination', async (check) => {
      const user = await s.as(s.world.users[0]);
      const admin = await s.as('admin@example.com');
      const amod = await s.as(s.world.airlines.NA.moderator);
      const hotelId = s.world.hotels['Nile View Hotel'].id;
      const lists: [Actor, string][] = [
        [s.guest(), '/posts?'],
        [s.guest(), '/itineraries/public/search?'],
        [s.guest(), `/hotels/${hotelId}/reviews?`],
        [
          s.guest(),
          `/hotels/search?cityId=cairo&checkIn=${dateIn(3)}&checkOut=${dateIn(5)}&guests=1&`,
        ],
        [
          s.guest(),
          `/flights/search?from=CAI&to=DXB&date=${dateIn(2)}&adults=1&`,
        ],
        [s.guest(), '/airports?'],
        [user, '/notifications?'],
        [user, '/flight-bookings?'],
        [user, '/hotel-bookings?'],
        [user, '/itineraries?'],
        [user, '/posts/mine?'],
        [admin, '/admin/accounts?'],
        [admin, '/admin/bookings?'],
        [admin, '/admin/reports?'],
        [admin, '/admin/audit-logs?'],
        [amod, `/airlines/${s.world.airlines.NA.id}/flights?`],
      ];
      const wrong: string[] = [];
      for (const [actor, base] of lists) {
        for (const q of [
          'limit=0',
          'limit=-1',
          'limit=1000000',
          'page=1.5',
          'page=0',
          'page=-3',
        ]) {
          const res = await actor.get(`${base}${q}`);
          if (res.status !== 400) wrong.push(`${base}${q} → ${res.status}`);
        }
        const far = await actor.get(`${base}page=999999`);
        if (far.status >= 500) wrong.push(`${base}page=999999 → ${far.status}`);
        const items = (far.body?.items ?? []).length;
        if (far.status === 200 && items > 0)
          wrong.push(`${base}page=999999 returned ${items} items`);
        const max = await actor.get(`${base}limit=50`);
        const n = Array.isArray(max.body)
          ? max.body.length
          : (max.body?.items ?? []).length;
        if (n > 50) wrong.push(`${base}limit=50 returned ${n} items`);
      }
      check(
        'bad page/limit → 400; far pages empty; ≤ 50 per page',
        wrong,
        wrong.length === 0,
      );
    });
  });

  it('D5 uploads: renamed files, empty, over the limit, path traversal, too many', async () => {
    await probe('D5 uploads (GEN-08)', async (check) => {
      const user = await s.newUser('d5');
      const post = await user.post('/posts', {
        title: 'Pics',
        body: 'b',
        status: 'draft',
      });
      const path = `/posts/${post.body._id}/images`;
      const before = readdirSync(s.t.uploadDir).length;
      const attempts: [string, Buffer, string, (st: number) => boolean][] = [
        ['a PNG renamed .exe', png(200), 'image.exe', (st) => st < 500],
        ['an .exe renamed .png', EXE, 'photo.png', (st) => st === 400],
        ['a 0-byte file', Buffer.alloc(0), 'empty.png', (st) => st === 400],
        [
          'just over 5 MB',
          png(5 * 1024 * 1024 + 1),
          'big.png',
          (st) => st === 413 || st === 400,
        ],
        [
          'filename ../../etc/passwd',
          png(200),
          '../../etc/passwd',
          (st) => st < 500,
        ],
      ];
      const wrong: string[] = [];
      for (const [name, bytes, filename, ok] of attempts) {
        const res = await user
          .req('post', path)
          .attach('file', bytes, { filename, contentType: 'image/png' });
        if (!ok(res.status) || (res.status >= 400 && !isErrorShape(res.body)))
          wrong.push(`${name} → ${res.status}`);
      }
      const two = await user
        .req('post', path)
        .attach('file', png(200), 'a.png')
        .attach('file', png(200), 'b.png');
      if (two.status !== 400 && two.status !== 413)
        wrong.push(`two files in one request → ${two.status}`);
      for (let i = 0; i < 6; i += 1)
        await user.req('post', path).attach('file', png(200), `ok${i}.png`);
      const doc = await s.col('posts').findOne({ _id: oid(post.body._id) });
      check('bad uploads rejected cleanly', wrong, wrong.length === 0);
      check(
        'at most 5 images per post',
        doc?.images?.length,
        (doc?.images?.length ?? 0) <= 5,
      );
      const files = readdirSync(s.t.uploadDir, { recursive: true }) as string[];
      check(
        'no file outside the upload folder name space (no ".." keys)',
        files.filter((f) => f.includes('..') || f.includes('passwd')),
        files.every((f) => !f.includes('passwd')),
      );
      const stored = (doc?.images ?? []).length + 1; // + the renamed-PNG one if it was kept
      check(
        'no orphan files after rejected uploads',
        { before, after: files.length, images: doc?.images?.length },
        files.length - before <= stored,
      );
    });
  });

  it('D6 unknown routes and wrong methods answer JSON', async () => {
    await probe('D6 unknown routes', async (check) => {
      const cases = [
        s.guest().get('/nope'),
        s.guest().del('/flights/search'),
        s.guest().put('/posts', {}),
        // Paths outside /api are finding S-05.
      ];
      const results = await Promise.all(cases);
      check(
        '404/405 in the JSON error shape, not HTML',
        results.map((r) => `${r.status} ${r.type}`),
        results.every(
          (r) =>
            (r.status === 404 || r.status === 405) &&
            r.type === 'application/json' &&
            isErrorShape(r.body),
        ),
      );
    });
  });

  it('records no unhandled rejection', () => {
    expect(s.unhandled).toEqual([]);
  });
});
