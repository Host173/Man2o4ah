import { randomBytes } from 'node:crypto';
import type { ApiResponse, DemoApi } from './demo-api.js';
import type {
  DemoAirline,
  DemoHotel,
  DemoModerator,
  DemoPlan,
  DemoUser,
} from './demo-plan.js';
import { addDays, arrivalLocalOf, firstFlightDay } from './demo-time.js';

export const DEMO_KINDS = [
  'airlines',
  'airlineModerators',
  'flights',
  'cabins',
  'hotels',
  'hotelModerators',
  'rooms',
  'availabilityRanges',
  'users',
] as const;

export type DemoKind = (typeof DEMO_KINDS)[number];

export interface DemoSeedResult {
  created: Record<DemoKind, number>;
  skipped: Record<DemoKind, number>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
type Record_ = Record<string, unknown>;

interface Context {
  plan: DemoPlan;
  log: (line: string) => void;
  result: DemoSeedResult;
}

interface Provider<T> {
  item: T;
  id: string;
  /** Logged in as the provider's moderator. */
  api: DemoApi;
}

const PAGE_SIZE = 50;

function isRecord(value: unknown): value is Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringField(value: unknown, key: string, what: string): string {
  const found = field(value, key);
  if (typeof found !== 'string' || found === '') {
    throw new Error(`${what}: the response has no "${key}"`);
  }
  return found;
}

function arrayField(value: unknown, key: string): unknown[] {
  const found = field(value, key);
  return Array.isArray(found) ? found : [];
}

/** The error `code` and `message` of a response, never anything else. */
function describeFailure(response: ApiResponse): string {
  const code = field(response.body, 'code');
  const message = field(response.body, 'message');
  return [
    `status ${response.status}`,
    typeof code === 'string' ? code : undefined,
    typeof message === 'string' ? message : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' ');
}

async function call(
  api: DemoApi,
  method: Method,
  path: string,
  body: unknown,
  ok: readonly number[],
): Promise<ApiResponse> {
  let response: ApiResponse;
  if (method === 'GET') response = await api.get(path);
  else if (method === 'POST') response = await api.post(path, body);
  else if (method === 'PUT') response = await api.put(path, body);
  else response = await api.patch(path, body);
  if (!ok.includes(response.status)) {
    throw new Error(`${method} ${path} failed: ${describeFailure(response)}`);
  }
  return response;
}

/** Every item of a paginated list endpoint. */
async function listAll(api: DemoApi, path: string): Promise<unknown[]> {
  const items: unknown[] = [];
  const separator = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page += 1) {
    const { body } = await call(
      api,
      'GET',
      `${path}${separator}page=${page}&limit=${PAGE_SIZE}`,
      undefined,
      [200],
    );
    items.push(...arrayField(body, 'items'));
    const totalPages = field(body, 'totalPages');
    if (typeof totalPages !== 'number' || page >= totalPages) return items;
  }
}

/** The signed-in user when the credentials work, `null` on a 401. */
async function tryLogin(
  api: DemoApi,
  email: string,
  password: string,
): Promise<unknown> {
  const response = await api.login(email, password);
  if (response.status === 200) return field(response.body, 'user') ?? null;
  if (response.status === 401) return null;
  // Never print the body of a login.
  throw new Error(`POST /auth/login failed: status ${response.status}`);
}

function created(context: Context, kind: DemoKind, what: string): void {
  context.result.created[kind] += 1;
  if (context.plan.verbose) context.log(`${kind}: created ${what}`);
}

function skipped(context: Context, kind: DemoKind, what: string): void {
  context.result.skipped[kind] += 1;
  if (context.plan.verbose) context.log(`${kind}: skipped ${what}`);
}

function temporaryPassword(): string {
  return `Tmp1-${randomBytes(12).toString('hex')}`;
}

/** Creates a moderator and takes it through the forced password change (ACC-07a). */
async function createModerator(
  context: Context,
  admin: DemoApi,
  moderator: DemoModerator,
  role: 'airline_moderator' | 'hotel_moderator',
  providerId: string,
  api: DemoApi,
): Promise<void> {
  const temporary = temporaryPassword();
  await call(
    admin,
    'POST',
    '/admin/moderators',
    {
      name: moderator.name,
      email: moderator.email,
      role,
      providerId,
      temporaryPassword: temporary,
    },
    [201],
  );
  const first = await tryLogin(api, moderator.email, temporary);
  if (first === null) {
    throw new Error(
      `POST /auth/login failed: the new moderator ${moderator.email} could not sign in`,
    );
  }
  await call(
    api,
    'PATCH',
    '/auth/change-password',
    { currentPassword: temporary, newPassword: context.plan.password },
    [200, 204],
  );
  // The change may end the session: sign in again with the demo password.
  if ((await tryLogin(api, moderator.email, context.plan.password)) === null) {
    throw new Error(
      `POST /auth/login failed: ${moderator.email} could not sign in after the password change`,
    );
  }
}

/**
 * Providers (airlines or hotels) with their moderators. An existing
 * moderator (it can sign in with the demo password) means the provider
 * exists too: its id is read from the moderator's account.
 */
async function provision<T extends { moderator: DemoModerator }>(
  context: Context,
  admin: DemoApi,
  items: readonly T[],
  options: {
    providerKind: 'airlines' | 'hotels';
    moderatorKind: 'airlineModerators' | 'hotelModerators';
    role: 'airline_moderator' | 'hotel_moderator';
    nameOf: (item: T) => string;
    createProvider: (item: T) => Promise<string>;
  },
): Promise<Provider<T>[]> {
  const providers: Provider<T>[] = [];
  for (const item of items) {
    const api = admin.fork();
    const { email } = item.moderator;
    const user = await tryLogin(api, email, context.plan.password);
    const name = options.nameOf(item);
    if (user !== null) {
      const id = stringField(
        field(user, 'moderatorOf'),
        'providerId',
        `moderator ${email}`,
      );
      skipped(context, options.providerKind, name);
      skipped(context, options.moderatorKind, email);
      providers.push({ item, id, api });
      continue;
    }
    const id = await options.createProvider(item);
    created(context, options.providerKind, name);
    await createModerator(
      context,
      admin,
      item.moderator,
      options.role,
      id,
      api,
    );
    created(context, options.moderatorKind, email);
    providers.push({ item, id, api });
  }
  return providers;
}

async function loadTimeZones(api: DemoApi): Promise<Map<string, string>> {
  const zones = new Map<string, string>();
  for (const airport of await listAll(api, '/airports')) {
    const id = field(airport, '_id');
    const timeZone = field(airport, 'timeZone');
    if (typeof id === 'string' && typeof timeZone === 'string') {
      zones.set(id, timeZone);
    }
  }
  return zones;
}

async function seedAirlineSchedule(
  context: Context,
  provider: Provider<DemoAirline>,
  zones: Map<string, string>,
): Promise<void> {
  const { item: airline, id, api } = provider;
  const { plan } = context;

  await call(
    api,
    'PUT',
    `/airlines/${id}/baggage-policy`,
    airline.baggagePolicy,
    [200],
  );
  await call(
    api,
    'PUT',
    `/airlines/${id}/cancellation-policy`,
    { tiers: airline.cancellationTiers },
    [200],
  );

  // flight number + local departure date -> flight id and the classes it has
  const existing = new Map<string, { id: string; classes: Set<string> }>();
  for (const flight of await listAll(api, `/airlines/${id}/flights`)) {
    const number = field(flight, 'flightNumber');
    const date = field(flight, 'departureLocalDate');
    const flightId = field(flight, '_id');
    if (
      typeof number !== 'string' ||
      typeof date !== 'string' ||
      typeof flightId !== 'string'
    ) {
      continue;
    }
    const classes = new Set<string>();
    for (const cabin of arrayField(flight, 'cabins')) {
      const cabinClass = field(cabin, 'cabinClass');
      if (typeof cabinClass === 'string') classes.add(cabinClass);
    }
    existing.set(`${number}|${date}`, { id: flightId, classes });
  }

  for (const route of airline.routes) {
    const fromZone = zones.get(route.from);
    const toZone = zones.get(route.to);
    if (fromZone === undefined || toZone === undefined) {
      context.log(
        `flights: skipping ${route.flightNumber} ${route.from}-${route.to}: an airport is missing from the reference data`,
      );
      continue;
    }
    const firstDay = firstFlightDay(
      plan.today,
      route.departureTime,
      fromZone,
      Date.now(),
    );
    for (let day = firstDay; day < firstDay + plan.flightDays; day += 1) {
      const date = addDays(plan.today, day);
      const label = `${route.flightNumber} on ${date}`;
      const found = existing.get(`${route.flightNumber}|${date}`);
      let flightId: string;
      let classes: Set<string>;
      if (found) {
        flightId = found.id;
        classes = found.classes;
        skipped(context, 'flights', label);
      } else {
        const departureLocal = `${date}T${route.departureTime}`;
        const { body } = await call(
          api,
          'POST',
          '/flights',
          {
            flightNumber: route.flightNumber,
            departureAirportId: route.from,
            arrivalAirportId: route.to,
            departureLocal,
            arrivalLocal: arrivalLocalOf(
              departureLocal,
              fromZone,
              route.durationMinutes,
              toZone,
            ),
          },
          [201],
        );
        flightId = stringField(body, '_id', `flight ${label}`);
        classes = new Set<string>();
        created(context, 'flights', label);
      }
      for (const cabin of route.cabins) {
        if (classes.has(cabin.cabinClass)) {
          skipped(context, 'cabins', `${label} ${cabin.cabinClass}`);
          continue;
        }
        await call(
          api,
          'POST',
          `/flights/${flightId}/cabins`,
          cabin,
          [200, 201],
        );
        created(context, 'cabins', `${label} ${cabin.cabinClass}`);
      }
    }
  }
}

async function seedHotelContent(
  context: Context,
  provider: Provider<DemoHotel>,
): Promise<void> {
  const { item: hotel, id, api } = provider;
  const { plan } = context;

  await call(
    api,
    'PUT',
    `/hotels/${id}/policies`,
    {
      checkInTime: hotel.checkInTime,
      checkOutTime: hotel.checkOutTime,
      cancellationPolicy: { tiers: hotel.cancellationTiers },
    },
    [200],
  );

  const rooms = new Map<string, { id: string; ranges: Record_[] }>();
  for (const room of await listAll(api, `/hotels/${id}/rooms`)) {
    const name = field(room, 'name');
    const roomId = field(room, '_id');
    if (typeof name !== 'string' || typeof roomId !== 'string') continue;
    rooms.set(name.trim().toLowerCase(), {
      id: roomId,
      ranges: arrayField(room, 'availability').filter(isRecord),
    });
  }

  const from = plan.today;
  const to = addDays(plan.today, plan.availabilityDays);
  for (const room of hotel.rooms) {
    const label = `${hotel.name} / ${room.name}`;
    let found = rooms.get(room.name.trim().toLowerCase());
    if (found) {
      skipped(context, 'rooms', label);
    } else {
      const { body } = await call(
        api,
        'POST',
        `/hotels/${id}/rooms`,
        room,
        [201],
      );
      found = { id: stringField(body, '_id', `room ${label}`), ranges: [] };
      created(context, 'rooms', label);
    }

    const covered = found.ranges.some(
      (range) =>
        typeof range.fromDate === 'string' &&
        typeof range.toDate === 'string' &&
        range.fromDate <= from &&
        range.toDate >= to,
    );
    if (covered) {
      skipped(context, 'availabilityRanges', label);
      continue;
    }
    // One range that covers what the room had and the wanted window, so no
    // night that was already bookable is taken away.
    const starts = [from];
    const ends = [to];
    for (const range of found.ranges) {
      if (typeof range.fromDate === 'string') starts.push(range.fromDate);
      if (typeof range.toDate === 'string') ends.push(range.toDate);
    }
    await call(
      api,
      'PATCH',
      `/hotels/${id}/rooms/${found.id}/availability`,
      {
        op: 'SET_RANGES',
        ranges: [
          { fromDate: starts.sort()[0], toDate: ends.sort().reverse()[0] },
        ],
      },
      [200],
    );
    created(context, 'availabilityRanges', label);
  }
}

async function seedUser(
  context: Context,
  admin: DemoApi,
  user: DemoUser,
): Promise<void> {
  const api = admin.fork();
  if ((await tryLogin(api, user.email, context.plan.password)) !== null) {
    skipped(context, 'users', user.email);
    return;
  }
  await call(
    api,
    'POST',
    '/auth/register',
    {
      name: user.name,
      email: user.email,
      password: context.plan.password,
      acceptTerms: true,
    },
    [201],
  );
  if (user.preferredCurrency !== undefined) {
    if ((await tryLogin(api, user.email, context.plan.password)) === null) {
      throw new Error(
        `POST /auth/login failed: ${user.email} could not sign in after registering`,
      );
    }
    await call(
      api,
      'PATCH',
      '/users/me',
      { preferredCurrency: user.preferredCurrency },
      [200],
    );
  }
  created(context, 'users', user.email);
}

function emptyCounts(): Record<DemoKind, number> {
  return Object.fromEntries(DEMO_KINDS.map((kind) => [kind, 0])) as Record<
    DemoKind,
    number
  >;
}

/**
 * Fills the database with the demo world through the public API (PLT-08).
 * Keyed by natural keys, so a second run creates nothing. A failing step
 * stops the run: no half-built world is left to continue from.
 */
export async function runDemoSeed(
  api: DemoApi,
  plan: DemoPlan,
  log: (line: string) => void,
): Promise<DemoSeedResult> {
  const context: Context = {
    plan,
    log,
    result: { created: emptyCounts(), skipped: emptyCounts() },
  };

  const admin = api;
  const adminUser = await tryLogin(
    admin,
    plan.admin.email,
    plan.admin.password,
  );
  if (adminUser === null) {
    throw new Error(
      'The admin could not sign in. Run `npm run seed:admin` first and check SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.',
    );
  }

  const airlines = await provision(context, admin, plan.airlines, {
    providerKind: 'airlines',
    moderatorKind: 'airlineModerators',
    role: 'airline_moderator',
    nameOf: (airline) => airline.name,
    createProvider: async (airline) => {
      const { body } = await call(
        admin,
        'POST',
        '/airlines',
        { name: airline.name, code: airline.code },
        [201],
      );
      return stringField(body, '_id', `airline ${airline.name}`);
    },
  });
  const zones = await loadTimeZones(admin);
  for (const airline of airlines) {
    await seedAirlineSchedule(context, airline, zones);
  }

  const hotels = await provision(context, admin, plan.hotels, {
    providerKind: 'hotels',
    moderatorKind: 'hotelModerators',
    role: 'hotel_moderator',
    nameOf: (hotel) => hotel.name,
    createProvider: async (hotel) => {
      const { body } = await call(
        admin,
        'POST',
        '/hotels',
        {
          name: hotel.name,
          address: hotel.address,
          cityId: hotel.cityId,
          description: hotel.description,
          starRating: hotel.starRating,
          amenities: hotel.amenities,
        },
        [201],
      );
      return stringField(body, '_id', `hotel ${hotel.name}`);
    },
  });
  for (const hotel of hotels) {
    await seedHotelContent(context, hotel);
  }

  for (const user of plan.users) {
    await seedUser(context, admin, user);
  }

  for (const kind of DEMO_KINDS) {
    log(
      `${kind}: ${context.result.created[kind]} created, ${context.result.skipped[kind]} skipped`,
    );
  }
  return context.result;
}
