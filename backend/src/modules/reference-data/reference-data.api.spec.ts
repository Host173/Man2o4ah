import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ReferenceDataModule } from './reference-data.module.js';
import { ReferenceDataSeedService } from './seed/reference-data-seed.service.js';

describe('Reference data HTTP API (GEN-12, FLT-02, GEN-05)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [ReferenceDataModule] });
    await t.moduleRef.get(ReferenceDataSeedService).run();
  }, HOOK_TIMEOUT);
  afterAll(() => t.close(), HOOK_TIMEOUT);

  const ids = (body: { items: { _id: string }[] }) =>
    body.items.map((item) => item._id);

  it.each(['countries', 'cities', 'airports', 'currencies', 'attractions'])(
    'GET /api/%s is public and returns the page shape',
    async (path) => {
      const res = await t.http().get(`/api/${path}`).expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 10 });
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.totalPages).toBe(Math.ceil(res.body.total / 10));
      expect(res.body.items[0]).toHaveProperty('_id');
      expect(res.body.items[0]).not.toHaveProperty('id');
    },
  );

  it('GET /api/countries sorts by name and filters by q (any case)', async () => {
    const all = await t.http().get('/api/countries').expect(200);
    expect(all.body.total).toBe(8);
    expect(all.body.items[0]).toEqual({
      _id: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });
    const names = all.body.items.map((c: { name: string }) => c.name);
    expect(names).toEqual([...names].sort());

    const united = await t.http().get('/api/countries?q=UNITED').expect(200);
    expect(ids(united.body)).toEqual(['AE', 'GB', 'US']);
  });

  it('GET /api/cities filters by countryCode (any case) and q', async () => {
    const us = await t.http().get('/api/cities?countryCode=us').expect(200);
    expect(us.body.items).toEqual([
      { _id: 'new_york', name: 'New York', countryCode: 'US' },
    ]);
    const res = await t
      .http()
      .get('/api/cities?q=a&countryCode=EG')
      .expect(200);
    expect(ids(res.body)).toEqual(['cairo']);
    const none = await t.http().get('/api/cities?countryCode=ZZ').expect(200);
    expect(none.body).toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('GET /api/airports (FLT-02) returns IATA code, city, country and time zone', async () => {
    const res = await t.http().get('/api/airports').expect(200);
    expect(ids(res.body)).toEqual([
      'CAI',
      'CDG',
      'DXB',
      'FRA',
      'HND',
      'JFK',
      'LHR',
      'RUH',
    ]);
    expect(res.body.items[0]).toEqual({
      _id: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    });
  });

  it('GET /api/airports q matches the code or the name; filters by city and country', async () => {
    const byCode = await t.http().get('/api/airports?q=jfk').expect(200);
    expect(ids(byCode.body)).toEqual(['JFK']);
    const byName = await t.http().get('/api/airports?q=heathrow').expect(200);
    expect(ids(byName.body)).toEqual(['LHR']);
    const byCity = await t.http().get('/api/airports?cityId=tokyo').expect(200);
    expect(ids(byCity.body)).toEqual(['HND']);
    const byCountry = await t
      .http()
      .get('/api/airports?countryCode=de')
      .expect(200);
    expect(ids(byCountry.body)).toEqual(['FRA']);
  });

  it('GET /api/currencies lists every supported currency by code', async () => {
    const res = await t.http().get('/api/currencies').expect(200);
    expect(ids(res.body)).toEqual([
      'AED',
      'EGP',
      'EUR',
      'GBP',
      'JPY',
      'SAR',
      'USD',
    ]);
    expect(res.body.items).toContainEqual({
      _id: 'JPY',
      name: 'Japanese Yen',
      minorUnits: 0,
    });
  });

  it('GET /api/attractions filters by cityId and q', async () => {
    const paris = await t
      .http()
      .get('/api/attractions?cityId=paris')
      .expect(200);
    expect(paris.body.items).toEqual([
      { _id: 'att-5', name: 'Louvre Museum', cityId: 'paris' },
    ]);
    const museums = await t.http().get('/api/attractions?q=museum').expect(200);
    expect(ids(museums.body)).toEqual(['att-3', 'att-5']); // British, Louvre
    const unicode = await t
      .http()
      .get(`/api/attractions?q=${encodeURIComponent('römer')}`)
      .expect(200);
    expect(ids(unicode.body)).toEqual(['att-8']);
  });

  it('paginates (GEN-05): page 2 of size 3 continues page 1, no overlap', async () => {
    const p1 = await t.http().get('/api/airports?limit=3&page=1').expect(200);
    const p3 = await t.http().get('/api/airports?limit=3&page=3').expect(200);
    const p2 = await t.http().get('/api/airports?limit=3&page=2').expect(200);
    expect([...ids(p1.body), ...ids(p2.body), ...ids(p3.body)]).toEqual([
      'CAI',
      'CDG',
      'DXB',
      'FRA',
      'HND',
      'JFK',
      'LHR',
      'RUH',
    ]);
    expect(p3.body).toMatchObject({ total: 8, totalPages: 3, limit: 3 });
    const past = await t.http().get('/api/airports?page=9').expect(200);
    expect(past.body.items).toEqual([]);
  });

  it('treats q literally: regex characters match nothing and do not fail', async () => {
    for (const q of ['.*', '(', '[a-z]', '\\']) {
      const res = await t
        .http()
        .get(`/api/countries?q=${encodeURIComponent(q)}`)
        .expect(200);
      expect(res.body.total).toBe(0);
    }
    const blank = await t.http().get('/api/countries?q=%20%20').expect(200);
    expect(blank.body.total).toBe(8); // blank q = no filter
  });

  it.each([
    '/api/countries?limit=51',
    '/api/cities?page=0',
    '/api/airports?limit=abc',
    `/api/attractions?q=${'x'.repeat(101)}`,
    '/api/airports?cityId=a&cityId=b',
    '/api/currencies?unknown=1',
  ])('rejects bad query %s with 400 VALIDATION_FAILED', async (url) => {
    const res = await t.http().get(url).expect(400);
    expect(res.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it('registers the five paths in Swagger', () => {
    const doc = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    for (const path of [
      'countries',
      'cities',
      'airports',
      'currencies',
      'attractions',
    ]) {
      expect(doc.paths[`/api/${path}`]?.get).toBeDefined();
    }
    expect(doc.components?.schemas).toHaveProperty(
      'PaginatedAirportsResponseDto',
    );
  });
});
