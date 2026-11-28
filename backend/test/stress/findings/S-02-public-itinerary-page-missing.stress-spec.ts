/**
 * S-02 · MEDIUM · access
 *
 * Rule broken: ITN-21 "allow a guest or registered user to … view a public
 * itinerary read-only with author, days, activities and budget", and
 * endpoints.md "GET /api/itineraries/public/:id (Pub) | ITN-21".
 *
 * What breaks: the documented public page doesn't exist. A guest (or another
 * user) asking for a public itinerary gets 404 NOT_FOUND, so a public
 * itinerary can only be found in search, never opened read-only.
 *
 * Cause: src/modules/itineraries/itineraries.controller.ts:115 declares only
 * `@Public() @Get('public/search')`; there is no `public/:id` route, and
 * `GET :id` (:180) is owner-only and needs a login.
 *
 * Suggested fix: add `@Public() @Get('public/:id')` (declared before `:id`)
 * returning the read-only public view (author, days, activities, budget),
 * 404 for private, hidden or author-deactivated itineraries.
 */
import { createStressApp, dateIn, type Stress } from '../support/stress-app.js';

describe('S-02 the public itinerary page (ITN-21)', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(() => s?.close());

  it('lets a guest open a public itinerary read-only, never a private one', async () => {
    const owner = await s.newUser('s02');
    const open = await owner.post('/itineraries', {
      title: 'Open trip',
      countryCodes: ['EG'],
      startDate: dateIn(10),
    });
    await owner.post(`/itineraries/${open.body._id}/days`, { cityId: 'cairo' });
    const published = await owner.patch(`/itineraries/${open.body._id}`, {
      visibility: 'public',
    });
    expect(published.status).toBe(200);
    const hidden = await owner.post('/itineraries', {
      title: 'Hidden trip',
      countryCodes: ['EG'],
      startDate: dateIn(10),
    });

    const page = await s.guest().get(`/itineraries/public/${open.body._id}`);
    expect(
      page.status,
      'ITN-21 / endpoints.md: GET /api/itineraries/public/:id is public and serves public itineraries',
    ).toBe(200);
    expect(page.body.title).toBe('Open trip');
    const privatePage = await s
      .guest()
      .get(`/itineraries/public/${hidden.body._id}`);
    expect(privatePage.status, 'ACC-11: private itineraries stay hidden').toBe(
      404,
    );
  });
});
