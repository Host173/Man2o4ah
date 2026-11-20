import { createFullApp, DEMO_ACCOUNTS, JOURNEY_TIMEOUT } from './full-app.js';
import type { FullApp } from './full-app.js';
import { HOOK_TIMEOUT } from './mongo-memory.js';

describe(
  'the whole-app journey harness (TST-01)',
  { timeout: JOURNEY_TIMEOUT },
  () => {
    let app: FullApp;

    beforeAll(async () => {
      app = await createFullApp();
    }, HOOK_TIMEOUT);
    afterAll(() => app.t.close(), HOOK_TIMEOUT);

    it('seeds the demo world', async () => {
      const flights = await app.t.connection
        .collection('flights')
        .countDocuments();
      const hotels = await app.t.connection
        .collection('hotels')
        .countDocuments();
      expect(flights).toBeGreaterThan(0);
      expect(hotels).toBe(app.world.plan.hotels.length);
    });

    it('logs in as the admin, a user and every kind of moderator', async () => {
      const admin = await app.admin();
      const sara = await app.as(DEMO_ACCOUNTS.sara);
      const airline = await app.as(DEMO_ACCOUNTS.nileAirModerator);
      const hotel = await app.as(DEMO_ACCOUNTS.nileViewModerator);
      const roles = await Promise.all(
        [admin, sara, airline, hotel].map(async (actor) => {
          const me = await actor.get('/api/auth/me').expect(200);
          return (me.body as { role: string }).role;
        }),
      );
      expect(roles).toEqual([
        'admin',
        'user',
        'airline_moderator',
        'hotel_moderator',
      ]);
    });

    it('registers a fresh user per scenario', async () => {
      const user = await app.newUser();
      await user.get('/api/auth/me').expect(200);
    });

    it('holds the invariants on the fresh world', async () => {
      await app.expectInvariants();
    });
  },
);
