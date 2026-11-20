import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type request from 'supertest';
import { createFullApp, JOURNEY_TIMEOUT } from '../support/full-app.js';
import type { Actor, FullApp } from '../support/full-app.js';
import { imageBytes } from '../support/image-fixtures.js';
import { HOOK_TIMEOUT } from '../support/mongo-memory.js';

interface ImageBody {
  _id: string;
  key: string;
  url: string;
}

interface ActivityBody {
  _id: string;
  name: string;
  description?: string;
  time?: string;
  cost?: { amountMinor: number; currency: string };
  images: ImageBody[];
}

interface BudgetEntryBody {
  _id: string;
  category: string;
  amountMinor: number;
  currency: string;
}

interface DayBody {
  _id: string;
  dayNumber: number;
  date: string;
  cityId: string;
  notes?: string;
  activities: ActivityBody[];
  budgetEntries: BudgetEntryBody[];
}

interface CityGroupBody {
  cityId: string;
  fromDay: number;
  toDay: number;
  dayCount: number;
  checkIn: string;
  checkOut: string;
}

interface TransportCostBody {
  _id: string;
  dayId: string;
  mode: string;
  fromCityId: string;
  toCityId: string;
  amountMinor: number;
  currency: string;
}

interface ItineraryBody {
  _id: string;
  ownerId: string;
  title: string;
  countryCodes: string[];
  startDate: string;
  dayCount: number;
  visibility: string;
  isHidden: boolean;
  days: DayBody[];
  cityGroups: CityGroupBody[];
  transportCosts: TransportCostBody[];
  clonedFrom?: { itineraryId: string; authorId: string };
}

interface Money {
  amountMinor: number;
  currency: string;
}

interface SummaryBody {
  displayCurrency: string;
  rateDate: string;
  total: Money;
  byCategory: Record<string, Money>;
  byDay: { dayId: string; dayNumber: number; date: string; total: Money }[];
  byCityGroup: {
    cityId: string;
    fromDay: number;
    toDay: number;
    dayCount: number;
    total: Money;
  }[];
}

interface PublicItemBody {
  _id: string;
  ownerId: string;
  title: string;
  countryCodes: string[];
  startDate: string;
  dayCount: number;
  cityIds: string[];
}

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface FlightItemBody {
  flight: { flightNumber: string; departureLocalDate: string };
  matchingCabins: unknown[];
}

interface ReportBody {
  _id: string;
  status: string;
}

const DAY_MS = 86_400_000;

function isoDate(offsetDays: number, from = new Date()): string {
  const base = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  return new Date(base + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

describe(
  'Itinerary to clone journey (ITN-01..26, GEN-08)',
  { timeout: JOURNEY_TIMEOUT },
  () => {
    let app: FullApp;

    beforeAll(async () => {
      app = await createFullApp();
    }, HOOK_TIMEOUT);
    afterAll(() => app.t.close(), HOOK_TIMEOUT);

    const guest = () => app.t.http();
    const startDate = () => isoDate(3);

    function attachImage(
      call: request.Test,
      format: 'jpg' | 'png' = 'png',
    ): request.Test {
      return call.attach('file', imageBytes(format), {
        filename: `photo.${format}`,
        contentType: format === 'png' ? 'image/png' : 'image/jpeg',
      });
    }

    async function createItinerary(
      owner: Actor,
      options: { title?: string; countryCodes?: string[]; start?: string } = {},
    ): Promise<ItineraryBody> {
      const res = await owner
        .post('/api/itineraries')
        .send({
          title: options.title ?? `Journey trip ${randomUUID()}`,
          countryCodes: options.countryCodes ?? ['EG'],
          startDate: options.start ?? startDate(),
        })
        .expect(201);
      return res.body as ItineraryBody;
    }

    async function addDay(
      owner: Actor,
      itineraryId: string,
      cityId: string,
      notes?: string,
    ): Promise<DayBody> {
      const res = await owner
        .post(`/api/itineraries/${itineraryId}/days`)
        .send(notes === undefined ? { cityId } : { cityId, notes })
        .expect(201);
      return res.body as DayBody;
    }

    async function getItinerary(
      owner: Actor,
      id: string,
    ): Promise<ItineraryBody> {
      const res = await owner.get(`/api/itineraries/${id}`).expect(200);
      return res.body as ItineraryBody;
    }

    async function createTrip(
      owner: Actor,
      cityIds: string[],
      options: { title?: string; countryCodes?: string[] } = {},
    ): Promise<ItineraryBody> {
      const created = await createItinerary(owner, options);
      for (const cityId of cityIds) {
        await addDay(owner, created._id, cityId);
      }
      return getItinerary(owner, created._id);
    }

    async function addActivity(
      owner: Actor,
      itineraryId: string,
      dayId: string,
      body: Record<string, unknown>,
    ): Promise<ActivityBody> {
      const res = await owner
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send(body)
        .expect(201);
      const activities = (res.body as DayBody).activities;
      return activities[activities.length - 1] as ActivityBody;
    }

    async function addActivityImage(
      owner: Actor,
      activityId: string,
      format: 'jpg' | 'png' = 'png',
    ): Promise<ActivityBody> {
      const res = await attachImage(
        owner.post(`/api/activities/${activityId}/images`),
        format,
      ).expect(201);
      const found = (res.body as DayBody).activities.find(
        (activity) => activity._id === activityId,
      );
      return found as ActivityBody;
    }

    async function addBudget(
      owner: Actor,
      itineraryId: string,
      dayId: string,
      category: string,
      amountMinor: number,
      currency: string,
    ): Promise<BudgetEntryBody> {
      const res = await owner
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/budgets`)
        .send({ category, amountMinor, currency })
        .expect(201);
      return res.body as BudgetEntryBody;
    }

    async function addTransport(
      owner: Actor,
      itineraryId: string,
      body: Record<string, unknown>,
    ): Promise<TransportCostBody> {
      const res = await owner
        .post(`/api/itineraries/${itineraryId}/transport-costs`)
        .send(body)
        .expect(201);
      return res.body as TransportCostBody;
    }

    async function summary(
      owner: Actor,
      itineraryId: string,
    ): Promise<SummaryBody> {
      const res = await owner
        .get(`/api/itineraries/${itineraryId}/budget-summary`)
        .expect(200);
      return res.body as SummaryBody;
    }

    async function publicIds(query: string): Promise<string[]> {
      const res = await guest()
        .get(`/api/itineraries/public/search?limit=50&${query}`)
        .expect(200);
      return (res.body as Page<PublicItemBody>).items.map((item) => item._id);
    }

    async function setVisibility(
      owner: Actor,
      id: string,
      visibility: 'public' | 'private',
    ): Promise<ItineraryBody> {
      const res = await owner
        .patch(`/api/itineraries/${id}`)
        .send({ visibility })
        .expect(200);
      return res.body as ItineraryBody;
    }

    async function expectFile(key: string, exists: boolean): Promise<void> {
      const check = access(join(app.t.uploadDir, key));
      if (exists) await expect(check).resolves.toBeUndefined();
      else await expect(check).rejects.toThrow();
    }

    function imagesOf(itinerary: ItineraryBody): ImageBody[] {
      return itinerary.days.flatMap((day) =>
        day.activities.flatMap((activity) => activity.images),
      );
    }

    it('creates a private itinerary and validates its input (ITN-01)', async () => {
      const owner = await app.newUser('Trip Owner');
      const title = `  Egypt in a week ${randomUUID()}  `;
      const res = await owner
        .post('/api/itineraries')
        .send({ title, countryCodes: ['EG', 'AE'], startDate: startDate() })
        .expect(201);
      const created = res.body as ItineraryBody;
      expect(created).toMatchObject({
        title: title.trim(),
        countryCodes: ['EG', 'AE'],
        startDate: startDate(),
        dayCount: 0,
        visibility: 'private',
        days: [],
        cityGroups: [],
        transportCosts: [],
      });

      const invalid: Record<string, unknown>[] = [
        { title: '', countryCodes: ['EG'], startDate: startDate() },
        {
          title: 'x'.repeat(101),
          countryCodes: ['EG'],
          startDate: startDate(),
        },
        { title: 'No countries', countryCodes: [], startDate: startDate() },
        { title: 'Unknown', countryCodes: ['ZZ'], startDate: startDate() },
        { title: 'Bad date', countryCodes: ['EG'], startDate: 'next week' },
      ];
      for (const body of invalid) {
        const bad = await owner.post('/api/itineraries').send(body).expect(400);
        expect(bad.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      await guest()
        .post('/api/itineraries')
        .send({ title: 'Anon', countryCodes: ['EG'], startDate: startDate() })
        .expect(401);

      const edited = await owner
        .patch(`/api/itineraries/${created._id}`)
        .send({ title: 'Renamed', startDate: isoDate(5) })
        .expect(200);
      expect(edited.body).toMatchObject({
        title: 'Renamed',
        startDate: isoDate(5),
        visibility: 'private',
      });
      const mine = await owner.get('/api/itineraries').expect(200);
      expect((mine.body as Page<ItineraryBody>).items).toMatchObject([
        { _id: created._id, title: 'Renamed', dayCount: 0 },
      ]);

      await owner.delete(`/api/itineraries/${created._id}`).expect(204);
      await owner.get(`/api/itineraries/${created._id}`).expect(404);
      const afterDelete = await owner.get('/api/itineraries').expect(200);
      expect((afterDelete.body as Page<ItineraryBody>).total).toBe(0);
    });

    it('numbers days, derives their dates and groups consecutive cities (ITN-05, ITN-09)', async () => {
      const owner = await app.newUser();
      const created = await createItinerary(owner);

      const first = await addDay(owner, created._id, 'cairo', 'Arrival');
      expect(first).toMatchObject({
        dayNumber: 1,
        date: startDate(),
        cityId: 'cairo',
        notes: 'Arrival',
        activities: [],
      });
      await addDay(owner, created._id, 'cairo');
      const third = await addDay(owner, created._id, 'dubai');
      expect(third).toMatchObject({
        dayNumber: 3,
        date: isoDate(5),
        cityId: 'dubai',
      });

      const detail = await getItinerary(owner, created._id);
      expect(detail.dayCount).toBe(3);
      expect(detail.cityGroups).toEqual([
        {
          cityId: 'cairo',
          fromDay: 1,
          toDay: 2,
          dayCount: 2,
          checkIn: startDate(),
          checkOut: isoDate(5),
        },
        {
          cityId: 'dubai',
          fromDay: 3,
          toDay: 3,
          dayCount: 1,
          checkIn: isoDate(5),
          checkOut: isoDate(6),
        },
      ]);

      const unknownCity = await owner
        .post(`/api/itineraries/${created._id}/days`)
        .send({ cityId: 'atlantis' })
        .expect(400);
      expect(unknownCity.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      await owner
        .post(`/api/itineraries/${created._id}/days`)
        .send({ cityId: 'cairo', dayNumber: 9 })
        .expect(400);

      const moved = await owner
        .patch(`/api/itineraries/${created._id}/days/${third._id}`)
        .send({ cityId: 'cairo', notes: 'Back in Cairo' })
        .expect(200);
      expect(moved.body).toMatchObject({
        cityId: 'cairo',
        notes: 'Back in Cairo',
      });
      const regrouped = await getItinerary(owner, created._id);
      expect(regrouped.cityGroups).toMatchObject([
        { cityId: 'cairo', fromDay: 1, toDay: 3, dayCount: 3 },
      ]);
    });

    it('reorders and deletes days with numbers, dates, groups and totals following (ITN-07, ITN-08, ITN-14)', async () => {
      const owner = await app.newUser();
      const trip = await createTrip(owner, [
        'cairo',
        'cairo',
        'dubai',
        'london',
      ]);
      const [a, b, c, d] = trip.days as [DayBody, DayBody, DayBody, DayBody];
      await addBudget(owner, trip._id, a._id, 'food', 1000, 'USD');
      await addBudget(owner, trip._id, b._id, 'food', 2000, 'USD');
      await addBudget(owner, trip._id, c._id, 'food', 4000, 'USD');
      await addBudget(owner, trip._id, d._id, 'food', 8000, 'USD');
      const transport = await addTransport(owner, trip._id, {
        dayId: d._id,
        mode: 'flight',
        fromCityId: 'dubai',
        toCityId: 'london',
        amountMinor: 5000,
        currency: 'USD',
      });
      expect((await summary(owner, trip._id)).total).toEqual({
        amountMinor: 20000,
        currency: 'USD',
      });

      const reordered = await owner
        .patch(`/api/itineraries/${trip._id}/days/reorder`)
        .send({ dayIds: [c._id, a._id, b._id, d._id] })
        .expect(200);
      const view = reordered.body as ItineraryBody;
      expect(view.days.map((day) => day._id)).toEqual([
        c._id,
        a._id,
        b._id,
        d._id,
      ]);
      expect(view.days.map((day) => day.dayNumber)).toEqual([1, 2, 3, 4]);
      expect(view.days.map((day) => day.date)).toEqual([
        startDate(),
        isoDate(4),
        isoDate(5),
        isoDate(6),
      ]);
      expect(view.cityGroups).toEqual([
        {
          cityId: 'dubai',
          fromDay: 1,
          toDay: 1,
          dayCount: 1,
          checkIn: startDate(),
          checkOut: isoDate(4),
        },
        {
          cityId: 'cairo',
          fromDay: 2,
          toDay: 3,
          dayCount: 2,
          checkIn: isoDate(4),
          checkOut: isoDate(6),
        },
        {
          cityId: 'london',
          fromDay: 4,
          toDay: 4,
          dayCount: 1,
          checkIn: isoDate(6),
          checkOut: isoDate(7),
        },
      ]);
      const afterReorder = await summary(owner, trip._id);
      expect(afterReorder.total.amountMinor).toBe(20000);
      expect(afterReorder.byDay.map((day) => day.dayId)).toEqual([
        c._id,
        a._id,
        b._id,
        d._id,
      ]);
      expect(afterReorder.byDay.map((day) => day.total.amountMinor)).toEqual([
        4000, 1000, 2000, 13000,
      ]);

      for (const dayIds of [
        [c._id, a._id, b._id],
        [a._id, a._id, b._id, c._id],
      ]) {
        const bad = await owner
          .patch(`/api/itineraries/${trip._id}/days/reorder`)
          .send({ dayIds })
          .expect(400);
        expect(bad.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      const stranger = await app.newUser();
      await stranger
        .patch(`/api/itineraries/${trip._id}/days/reorder`)
        .send({ dayIds: [a._id, b._id, c._id, d._id] })
        .expect(404);
      await stranger
        .delete(`/api/itineraries/${trip._id}/days/${a._id}`)
        .expect(404);

      await owner
        .delete(`/api/itineraries/${trip._id}/days/${c._id}`)
        .expect(204);
      const afterDelete = await getItinerary(owner, trip._id);
      expect(afterDelete.dayCount).toBe(3);
      expect(afterDelete.days.map((day) => day._id)).toEqual([
        a._id,
        b._id,
        d._id,
      ]);
      expect(afterDelete.days.map((day) => day.dayNumber)).toEqual([1, 2, 3]);
      expect(afterDelete.days.map((day) => day.date)).toEqual([
        startDate(),
        isoDate(4),
        isoDate(5),
      ]);
      expect(afterDelete.cityGroups).toMatchObject([
        { cityId: 'cairo', fromDay: 1, toDay: 2, checkOut: isoDate(5) },
        { cityId: 'london', fromDay: 3, toDay: 3 },
      ]);
      expect((await summary(owner, trip._id)).total.amountMinor).toBe(16000);

      await owner
        .delete(`/api/itineraries/${trip._id}/days/${d._id}`)
        .expect(204);
      const last = await getItinerary(owner, trip._id);
      expect(last.transportCosts).toEqual([]);
      expect((await summary(owner, trip._id)).total.amountMinor).toBe(3000);
      await owner
        .delete(`/api/itineraries/${trip._id}/days/${d._id}`)
        .expect(404);
      expect(transport.dayId).toBe(d._id);
    });

    it('adds, edits and deletes activities with images, and cleans their files up (ITN-10, ITN-12, GEN-08)', async () => {
      const owner = await app.newUser();
      const stranger = await app.newUser();
      const trip = await createTrip(owner, ['cairo', 'dubai']);
      const [day, otherDay] = trip.days as [DayBody, DayBody];

      const activity = await addActivity(owner, trip._id, day._id, {
        name: '  Pyramids of Giza  ',
        description: 'Guided tour',
        time: '09:30',
        cost: { amountMinor: 2000, currency: 'EGP' },
      });
      expect(activity).toMatchObject({
        name: 'Pyramids of Giza',
        description: 'Guided tour',
        time: '09:30',
        cost: { amountMinor: 2000, currency: 'EGP' },
        images: [],
      });
      const invalid: Record<string, unknown>[] = [
        { name: '   ' },
        { name: 'Bad time', time: '25:00' },
        { name: 'Bad cost', cost: { amountMinor: -1, currency: 'EGP' } },
        { name: 'Fractional', cost: { amountMinor: 1.5, currency: 'EGP' } },
      ];
      for (const body of invalid) {
        await owner
          .post(`/api/itineraries/${trip._id}/days/${day._id}/activities`)
          .send(body)
          .expect(400);
      }
      await stranger
        .post(`/api/itineraries/${trip._id}/days/${day._id}/activities`)
        .send({ name: 'Intruder' })
        .expect(404);

      const edited = await owner
        .patch(`/api/activities/${activity._id}`)
        .send({ name: 'Giza Plateau', time: '10:00' })
        .expect(200);
      expect(edited.body).toMatchObject({
        _id: activity._id,
        name: 'Giza Plateau',
        time: '10:00',
        description: 'Guided tour',
      });
      await stranger
        .patch(`/api/activities/${activity._id}`)
        .send({ name: 'Hijacked' })
        .expect(404);
      await stranger.delete(`/api/activities/${activity._id}`).expect(404);

      await attachImage(
        stranger.post(`/api/activities/${activity._id}/images`),
      ).expect(404);
      await attachImage(
        guest().post(`/api/activities/${activity._id}/images`),
      ).expect(401);
      await owner
        .post(`/api/activities/${activity._id}/images`)
        .attach('file', Buffer.from('plain text'), {
          filename: 'notes.png',
          contentType: 'image/png',
        })
        .expect(400);

      let current = await addActivityImage(owner, activity._id, 'png');
      current = await addActivityImage(owner, activity._id, 'jpg');
      expect(current.images).toHaveLength(2);
      const [png, jpg] = current.images as [ImageBody, ImageBody];
      expect(png.url).toBe(`/uploads/${png.key}`);
      expect(jpg.key).toMatch(/\.jpg$/);
      const served = await guest().get(png.url).expect(200);
      expect(served.headers['content-type']).toContain('image/png');
      for (let count = 0; count < 3; count += 1) {
        current = await addActivityImage(owner, activity._id);
      }
      expect(current.images).toHaveLength(5);
      const sixth = await attachImage(
        owner.post(`/api/activities/${activity._id}/images`),
      ).expect(400);
      expect(sixth.body).toMatchObject({ code: 'LIMIT_EXCEEDED' });

      await stranger
        .delete(`/api/activities/${activity._id}/images/${png._id}`)
        .expect(404);
      await owner
        .delete(`/api/activities/${activity._id}/images/${png._id}`)
        .expect(204);
      await expectFile(png.key, false);
      await expectFile(jpg.key, true);
      const reloaded = await getItinerary(owner, trip._id);
      expect(
        reloaded.days[0]?.activities[0]?.images.map((image) => image._id),
      ).not.toContain(png._id);
      expect(reloaded.days[0]?.activities[0]?.images).toHaveLength(4);

      await owner.delete(`/api/activities/${activity._id}`).expect(204);
      await owner.delete(`/api/activities/${activity._id}`).expect(404);
      expect((await getItinerary(owner, trip._id)).days[0]?.activities).toEqual(
        [],
      );

      const kept = await addActivity(owner, trip._id, otherDay._id, {
        name: 'Burj Khalifa',
      });
      const keptImage = (await addActivityImage(owner, kept._id)).images[0];
      await expectFile((keptImage as ImageBody).key, true);
      await owner
        .delete(`/api/itineraries/${trip._id}/days/${otherDay._id}`)
        .expect(204);
      await expectFile((keptImage as ImageBody).key, false);
    });

    it('converts budgets and transport costs to the preferred currency and shows the rate date (ITN-14, ITN-16, ITN-18)', async () => {
      const owner = await app.newUser();
      const stranger = await app.newUser();
      const trip = await createTrip(owner, ['cairo', 'cairo', 'dubai']);
      const [d1, d2, d3] = trip.days as [DayBody, DayBody, DayBody];

      await owner
        .patch('/api/users/me')
        .send({ preferredCurrency: 'EGP' })
        .expect(200);
      await addBudget(owner, trip._id, d1._id, 'food', 5000, 'EGP');
      const hotel = await addBudget(
        owner,
        trip._id,
        d1._id,
        'accommodation',
        10000,
        'USD',
      );
      await addActivity(owner, trip._id, d1._id, {
        name: 'Khan el-Khalili',
        cost: { amountMinor: 2000, currency: 'EGP' },
      });
      await addBudget(owner, trip._id, d2._id, 'in_city_transport', 900, 'EUR');
      await addActivity(owner, trip._id, d3._id, {
        name: 'Desert safari',
        cost: { amountMinor: 800, currency: 'GBP' },
      });
      await addTransport(owner, trip._id, {
        dayId: d3._id,
        mode: 'flight',
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amountMinor: 20000,
        currency: 'EGP',
      });

      const rates = await guest().get('/api/exchange-rates/latest').expect(200);
      const inEgp = await summary(owner, trip._id);
      expect(inEgp.displayCurrency).toBe('EGP');
      expect(inEgp.rateDate).toBe(
        (rates.body as { rateDate: string }).rateDate,
      );
      expect(inEgp.total).toEqual({ amountMinor: 627000, currency: 'EGP' });
      expect(
        Object.fromEntries(
          Object.entries(inEgp.byCategory).map(([key, value]) => [
            key,
            value.amountMinor,
          ]),
        ),
      ).toEqual({
        food: 5000,
        accommodation: 500000,
        in_city_transport: 50000,
        activities: 52000,
        intercity_transport: 20000,
      });
      expect(inEgp.byDay.map((day) => day.total.amountMinor)).toEqual([
        507000, 50000, 70000,
      ]);
      expect(inEgp.byCityGroup).toMatchObject([
        {
          cityId: 'cairo',
          fromDay: 1,
          toDay: 2,
          total: { amountMinor: 557000 },
        },
        {
          cityId: 'dubai',
          fromDay: 3,
          toDay: 3,
          total: { amountMinor: 70000 },
        },
      ]);

      await owner
        .patch('/api/users/me')
        .send({ preferredCurrency: 'USD' })
        .expect(200);
      const inUsd = await summary(owner, trip._id);
      expect(inUsd.displayCurrency).toBe('USD');
      expect(inUsd.total).toEqual({ amountMinor: 12540, currency: 'USD' });

      const lowered = await owner
        .patch(`/api/budgets/${hotel._id}`)
        .send({ amountMinor: 5000 })
        .expect(200);
      expect(lowered.body).toMatchObject({
        amountMinor: 5000,
        currency: 'USD',
      });
      expect((await summary(owner, trip._id)).total.amountMinor).toBe(7540);
      await owner.delete(`/api/budgets/${hotel._id}`).expect(204);
      expect((await summary(owner, trip._id)).total.amountMinor).toBe(2540);

      const badEntries: Record<string, unknown>[] = [
        { category: 'food', amountMinor: -1, currency: 'USD' },
        { category: 'food', amountMinor: 10.5, currency: 'USD' },
        { category: 'souvenirs', amountMinor: 100, currency: 'USD' },
      ];
      for (const body of badEntries) {
        await owner
          .post(`/api/itineraries/${trip._id}/days/${d1._id}/budgets`)
          .send(body)
          .expect(400);
      }
      await stranger
        .get(`/api/itineraries/${trip._id}/budget-summary`)
        .expect(404);
      await stranger
        .patch(`/api/budgets/${hotel._id}`)
        .send({ amountMinor: 1 })
        .expect(404);
      await guest()
        .get(`/api/itineraries/${trip._id}/budget-summary`)
        .expect(401);
    });

    it('finds hotels for a city group and flights to the first day city (ITN-25, ITN-26)', async () => {
      const owner = await app.newUser();
      const stranger = await app.newUser();
      const empty = await createItinerary(owner);
      const trip = await createTrip(owner, ['cairo', 'cairo', 'dubai']);

      const cairoHotels = await owner
        .get(
          `/api/itineraries/${trip._id}/hotels?groupIndex=0&guests=2&rooms=1`,
        )
        .expect(200);
      const cairoBody = cairoHotels.body as Page<{ name: string }>;
      expect(cairoBody.items.map((hotel) => hotel.name)).toContain(
        'Nile View Hotel',
      );
      expect(cairoBody.items.map((hotel) => hotel.name)).not.toContain(
        'Marina Bay Suites',
      );
      const dubaiHotels = await owner
        .get(`/api/itineraries/${trip._id}/hotels?groupIndex=1&guests=2`)
        .expect(200);
      expect(
        (dubaiHotels.body as Page<{ name: string }>).items.map(
          (hotel) => hotel.name,
        ),
      ).toContain('Marina Bay Suites');
      await owner
        .get(`/api/itineraries/${trip._id}/hotels?groupIndex=5&guests=2`)
        .expect(404);
      await owner
        .get(`/api/itineraries/${trip._id}/hotels?groupIndex=0`)
        .expect(400);
      await stranger
        .get(`/api/itineraries/${trip._id}/hotels?groupIndex=0&guests=2`)
        .expect(404);

      const oneWay = await owner
        .get(`/api/itineraries/${trip._id}/flights?origin=DXB`)
        .expect(200);
      const outbound = (oneWay.body as Page<FlightItemBody>).items;
      expect(outbound.map((item) => item.flight.flightNumber).sort()).toEqual([
        'GW 302',
        'NA 102',
      ]);
      for (const item of outbound) {
        expect(item.flight.departureLocalDate).toBe(startDate());
        expect(item.matchingCabins.length).toBeGreaterThan(0);
      }

      const roundTrip = await owner
        .get(
          `/api/itineraries/${trip._id}/flights?origin=DXB&tripType=round_trip`,
        )
        .expect(200);
      const both = roundTrip.body as {
        outbound: Page<FlightItemBody>;
        inbound: Page<FlightItemBody>;
      };
      expect(
        both.outbound.items.map((item) => item.flight.flightNumber).sort(),
      ).toEqual(['GW 302', 'NA 102']);
      expect(
        both.inbound.items.map((item) => item.flight.flightNumber).sort(),
      ).toEqual(['GW 301', 'NA 101']);
      for (const item of both.inbound.items) {
        expect(item.flight.departureLocalDate).toBe(isoDate(5));
      }

      await owner.get(`/api/itineraries/${trip._id}/flights`).expect(400);
      await owner
        .get(`/api/itineraries/${empty._id}/flights?origin=DXB`)
        .expect(400);
      await stranger
        .get(`/api/itineraries/${trip._id}/flights?origin=DXB`)
        .expect(404);
    });

    it('publishes an itinerary, finds it in public search and lets another user clone it with copied images (ITN-20, ITN-21)', async () => {
      const author = await app.newUser('Trip Author');
      const cloner = await app.newUser('Trip Cloner');
      const title = `Nile and Gulf ${randomUUID()}`;
      const trip = await createTrip(author, ['cairo', 'cairo', 'dubai'], {
        title,
        countryCodes: ['EG', 'AE'],
      });
      const [d1, , d3] = trip.days as [DayBody, DayBody, DayBody];
      const activity = await addActivity(author, trip._id, d1._id, {
        name: 'Pyramids of Giza',
        time: '09:00',
        cost: { amountMinor: 3000, currency: 'USD' },
      });
      await addActivityImage(author, activity._id, 'png');
      const withImages = await addActivityImage(author, activity._id, 'jpg');
      await addBudget(author, trip._id, d1._id, 'food', 4000, 'USD');
      await addBudget(author, trip._id, d3._id, 'accommodation', 9000, 'USD');
      await addTransport(author, trip._id, {
        dayId: d3._id,
        mode: 'flight',
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amountMinor: 20000,
        currency: 'USD',
      });
      const original = await getItinerary(author, trip._id);
      const originalImages = imagesOf(original);
      expect(originalImages).toHaveLength(2);
      const originalSummary = await summary(author, trip._id);
      expect(originalSummary.total.amountMinor).toBe(36000);

      expect(await publicIds(`q=${encodeURIComponent(title)}`)).toEqual([]);
      const published = await setVisibility(author, trip._id, 'public');
      expect(published.visibility).toBe('public');

      const search = await guest()
        .get(`/api/itineraries/public/search?q=${encodeURIComponent(title)}`)
        .expect(200);
      expect((search.body as Page<PublicItemBody>).items).toMatchObject([
        {
          _id: trip._id,
          ownerId: original.ownerId,
          title,
          countryCodes: ['EG', 'AE'],
          startDate: startDate(),
          dayCount: 3,
          cityIds: expect.arrayContaining(['cairo', 'dubai']),
        },
      ]);
      const titleQuery = `q=${encodeURIComponent(title)}`;
      expect(await publicIds(`${titleQuery}&minDays=3&maxDays=3`)).toEqual([
        trip._id,
      ]);
      expect(await publicIds(`${titleQuery}&minDays=4`)).toEqual([]);
      expect(await publicIds(`${titleQuery}&maxDays=2`)).toEqual([]);
      expect(await publicIds(`${titleQuery}&countryCode=AE`)).toEqual([
        trip._id,
      ]);
      expect(await publicIds(`${titleQuery}&countryCode=FR`)).toEqual([]);
      expect(await publicIds(`${titleQuery}&cityId=dubai`)).toEqual([trip._id]);
      expect(await publicIds(`${titleQuery}&cityId=london`)).toEqual([]);
      expect(await publicIds('q=Dubai')).toContain(trip._id);
      expect(await publicIds('q=Egypt')).toContain(trip._id);

      await guest().post(`/api/itineraries/${trip._id}/clone`).expect(401);
      const cloned = await cloner
        .post(`/api/itineraries/${trip._id}/clone`)
        .expect(201);
      const clone = cloned.body as ItineraryBody;
      expect(clone._id).not.toBe(trip._id);
      expect(clone).toMatchObject({
        title,
        countryCodes: ['EG', 'AE'],
        startDate: startDate(),
        dayCount: 3,
        visibility: 'private',
        isHidden: false,
        clonedFrom: { itineraryId: trip._id, authorId: original.ownerId },
      });
      expect(clone.ownerId).not.toBe(original.ownerId);
      expect(clone.days.map((day) => day.cityId)).toEqual([
        'cairo',
        'cairo',
        'dubai',
      ]);
      const originalIds = new Set([
        ...original.days.map((day) => day._id),
        ...original.days.flatMap((day) => day.activities.map((a) => a._id)),
        ...original.days.flatMap((day) => day.budgetEntries.map((b) => b._id)),
        ...original.transportCosts.map((cost) => cost._id),
      ]);
      const cloneIds = [
        ...clone.days.map((day) => day._id),
        ...clone.days.flatMap((day) => day.activities.map((a) => a._id)),
        ...clone.days.flatMap((day) => day.budgetEntries.map((b) => b._id)),
        ...clone.transportCosts.map((cost) => cost._id),
      ];
      expect(cloneIds.some((id) => originalIds.has(id))).toBe(false);
      expect(clone.days[0]?.activities[0]).toMatchObject({
        name: 'Pyramids of Giza',
        time: '09:00',
        cost: { amountMinor: 3000, currency: 'USD' },
      });
      expect(clone.days[0]?.budgetEntries).toMatchObject([
        { category: 'food', amountMinor: 4000 },
      ]);
      expect(clone.days[2]?.budgetEntries).toMatchObject([
        { category: 'accommodation', amountMinor: 9000 },
      ]);
      expect(clone.transportCosts).toMatchObject([
        { dayId: clone.days[2]?._id, amountMinor: 20000, mode: 'flight' },
      ]);
      expect((await summary(cloner, clone._id)).total).toEqual(
        originalSummary.total,
      );

      const cloneImages = imagesOf(clone);
      expect(cloneImages).toHaveLength(2);
      const originalKeys = new Set(originalImages.map((image) => image.key));
      for (const image of cloneImages) {
        expect(originalKeys.has(image.key)).toBe(false);
        await expectFile(image.key, true);
      }
      expect(cloneImages.map((i) => i.key.slice(-3)).sort()).toEqual([
        'jpg',
        'png',
      ]);
      expect(withImages.images).toHaveLength(2);

      expect(await publicIds(titleQuery)).toEqual([trip._id]);
      const clones = await cloner.get('/api/itineraries').expect(200);
      expect(
        (clones.body as Page<ItineraryBody>).items.map((item) => item._id),
      ).toEqual([clone._id]);
      await cloner.get(`/api/itineraries/${trip._id}`).expect(404);
      await cloner
        .patch(`/api/itineraries/${trip._id}`)
        .send({ title: 'Mine now' })
        .expect(404);
      await cloner.delete(`/api/itineraries/${trip._id}`).expect(404);

      const renamed = await cloner
        .patch(`/api/itineraries/${clone._id}`)
        .send({ title: 'My own version' })
        .expect(200);
      expect(renamed.body).toMatchObject({ title: 'My own version' });
      expect((await getItinerary(author, trip._id)).title).toBe(title);

      const reloaded = await getItinerary(cloner, clone._id);
      expect(reloaded).toMatchObject({
        title: 'My own version',
        dayCount: 3,
        clonedFrom: { itineraryId: trip._id, authorId: original.ownerId },
      });
      expect(
        imagesOf(reloaded)
          .map((image) => image.key)
          .sort(),
      ).toEqual(cloneImages.map((image) => image.key).sort());
      for (const image of imagesOf(reloaded)) {
        const served = await guest().get(image.url).expect(200);
        expect(served.headers['content-type']).toMatch(/image\/(png|jpeg)/);
      }
      expect((await summary(cloner, clone._id)).total).toEqual(
        originalSummary.total,
      );
    });

    it('never lists a private itinerary and answers 404 to everyone else (ITN-01, ITN-20)', async () => {
      const owner = await app.newUser();
      const stranger = await app.newUser();
      const title = `Secret plans ${randomUUID()}`;
      const trip = await createTrip(owner, ['cairo'], { title });
      const titleQuery = `q=${encodeURIComponent(title)}`;
      expect(trip.visibility).toBe('private');
      expect(await publicIds(titleQuery)).toEqual([]);

      await guest().get(`/api/itineraries/${trip._id}`).expect(401);
      await stranger.get(`/api/itineraries/${trip._id}`).expect(404);
      await stranger
        .patch(`/api/itineraries/${trip._id}`)
        .send({ title: 'Mine' })
        .expect(404);
      await stranger
        .patch(`/api/itineraries/${trip._id}`)
        .send({ visibility: 'public' })
        .expect(404);
      await stranger.delete(`/api/itineraries/${trip._id}`).expect(404);
      await stranger.post(`/api/itineraries/${trip._id}/clone`).expect(404);
      expect(await publicIds(titleQuery)).toEqual([]);
      const strangerList = await stranger.get('/api/itineraries').expect(200);
      expect((strangerList.body as Page<ItineraryBody>).total).toBe(0);

      await setVisibility(owner, trip._id, 'public');
      expect(await publicIds(titleQuery)).toEqual([trip._id]);
      await stranger.get(`/api/itineraries/${trip._id}`).expect(404);
      await stranger
        .patch(`/api/itineraries/${trip._id}`)
        .send({ title: 'Mine' })
        .expect(404);

      const back = await setVisibility(owner, trip._id, 'private');
      expect(back.visibility).toBe('private');
      expect(await publicIds(titleQuery)).toEqual([]);
      await stranger.post(`/api/itineraries/${trip._id}/clone`).expect(404);
    });

    it('drops a public itinerary from search and cloning once an admin hides it (GEN-09, GEN-10, ITN-20)', async () => {
      const admin = await app.admin();
      const author = await app.newUser();
      const reporter = await app.newUser();
      const title = `Reported trip ${randomUUID()}`;
      const trip = await createTrip(author, ['cairo'], { title });
      await setVisibility(author, trip._id, 'public');
      const titleQuery = `q=${encodeURIComponent(title)}`;
      expect(await publicIds(titleQuery)).toEqual([trip._id]);

      const filed = await reporter
        .post('/api/reports')
        .send({
          targetType: 'itinerary',
          targetId: trip._id,
          reason: 'Copied from a guidebook',
        })
        .expect(201);
      const resolved = await admin
        .patch(`/api/admin/reports/${(filed.body as ReportBody)._id}`)
        .send({ action: 'hide' })
        .expect(200);
      expect((resolved.body as ReportBody).status).toBe('content_hidden');

      expect(await publicIds(titleQuery)).toEqual([]);
      await reporter.post(`/api/itineraries/${trip._id}/clone`).expect(404);
      const own = await getItinerary(author, trip._id);
      expect(own).toMatchObject({ isHidden: true, title });
    });
  },
);
