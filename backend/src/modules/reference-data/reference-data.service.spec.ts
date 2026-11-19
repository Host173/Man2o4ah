import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ReferenceDataModule } from './reference-data.module.js';
import { ReferenceDataService } from './reference-data.service.js';
import { Airport } from './schemas/airport.schema.js';
import { Attraction } from './schemas/attraction.schema.js';
import { City } from './schemas/city.schema.js';
import { Country } from './schemas/country.schema.js';
import { Currency } from './schemas/currency.schema.js';
import { ReferenceDataSeedService } from './seed/reference-data-seed.service.js';

describe('ReferenceDataService (GEN-12) over the seeded datasets', () => {
  let t: TestApp;
  let service: ReferenceDataService;

  beforeAll(async () => {
    t = await createTestApp({ imports: [ReferenceDataModule] });
    await t.moduleRef.get(ReferenceDataSeedService).run();
    service = t.moduleRef.get(ReferenceDataService);
  }, HOOK_TIMEOUT);
  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('getAirport returns the view, or null for an unknown code', async () => {
    expect(await service.getAirport('CAI')).toEqual({
      code: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    });
    expect(await service.getAirport('XXX')).toBeNull();
    expect(await service.getAirport('cai')).toBeNull(); // codes are exact
  });

  it('getAirports leaves unknown codes out and ignores duplicates', async () => {
    const map = await service.getAirports(['CAI', 'LHR', 'XXX', 'CAI']);
    expect([...map.keys()].sort()).toEqual(['CAI', 'LHR']);
    expect(map.get('LHR')?.timeZone).toBe('Europe/London');
    expect((await service.getAirports([])).size).toBe(0);
  });

  it('getCity / getCities', async () => {
    expect(await service.getCity('new_york')).toEqual({
      id: 'new_york',
      name: 'New York',
      countryCode: 'US',
    });
    expect(await service.getCity('atlantis')).toBeNull();
    const map = await service.getCities(['paris', 'tokyo', 'atlantis']);
    expect([...map.keys()].sort()).toEqual(['paris', 'tokyo']);
    expect(map.get('paris')).toEqual({
      id: 'paris',
      name: 'Paris',
      countryCode: 'FR',
    });
  });

  it('getCountry / getCountries', async () => {
    expect(await service.getCountry('EG')).toEqual({
      code: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });
    expect(await service.getCountry('ZZ')).toBeNull();
    const map = await service.getCountries(['FR', 'DE', 'ZZ']);
    expect([...map.keys()].sort()).toEqual(['DE', 'FR']);
    expect(map.get('DE')?.currency).toBe('EUR');
  });

  it('findCityIds / findCountryCodes match part of the name, any case', async () => {
    expect(await service.findCityIds('YORK')).toEqual(['new_york']);
    expect((await service.findCityIds('r')).sort()).toEqual(
      ['cairo', 'frankfurt', 'new_york', 'riyadh', 'paris'].sort(),
    );
    expect(await service.findCityIds('nowhere')).toEqual([]);
    expect((await service.findCountryCodes('united')).sort()).toEqual([
      'AE',
      'GB',
      'US',
    ]);
  });

  it('find* treat regex characters literally (no injection, no crash)', async () => {
    expect(await service.findCityIds('.*')).toEqual([]);
    expect(await service.findCountryCodes('(')).toEqual([]);
    expect(await service.findCityIds('[a-z]')).toEqual([]);
  });

  it('getCurrency / listCurrencies (sorted by code, includes the platform currency)', async () => {
    expect(await service.getCurrency('JPY')).toEqual({
      code: 'JPY',
      name: 'Japanese Yen',
      minorUnits: 0,
    });
    expect(await service.getCurrency('XYZ')).toBeNull();
    const codes = (await service.listCurrencies()).map((c) => c.code);
    expect(codes).toEqual(['AED', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD']);
  });

  it('listAttractions returns the city attractions sorted by name; [] for unknown', async () => {
    await t.moduleRef
      .get<Model<Attraction>>(getModelToken(Attraction.name))
      .create({ _id: 'att-test', name: 'Al-Azhar Park', cityId: 'cairo' });
    try {
      expect(await service.listAttractions('cairo')).toEqual([
        { id: 'att-test', name: 'Al-Azhar Park', cityId: 'cairo' },
        { id: 'att-1', name: 'Giza Pyramids and Sphinx', cityId: 'cairo' },
      ]);
    } finally {
      await t.moduleRef
        .get<Model<Attraction>>(getModelToken(Attraction.name))
        .deleteOne({ _id: 'att-test' });
    }
    expect(await service.listAttractions('atlantis')).toEqual([]);
  });

  it('answers exactly like FakeReferenceDataService over the same data', async () => {
    const lean = <T>(name: string) =>
      t.moduleRef.get<Model<T>>(getModelToken(name)).find().lean<T[]>();
    const [airports, cities, countries, currencies, attractions] =
      await Promise.all([
        lean<Airport>(Airport.name),
        lean<City>(City.name),
        lean<Country>(Country.name),
        lean<Currency>(Currency.name),
        lean<Attraction>(Attraction.name),
      ]);
    const fake = new FakeReferenceDataService({
      airports: airports.map(({ _id, ...a }) => ({ code: _id, ...a })),
      cities: cities.map(({ _id, ...c }) => ({ id: _id, ...c })),
      countries: countries.map(({ _id, ...c }) => ({ code: _id, ...c })),
      currencies: currencies.map(({ _id, ...c }) => ({ code: _id, ...c })),
      attractions: attractions.map(({ _id, ...a }) => ({ id: _id, ...a })),
    });
    const calls: [string, (s: ReferenceDataService) => Promise<unknown>][] = [
      ['getAirport', (s) => s.getAirport('DXB')],
      ['getAirport miss', (s) => s.getAirport('NOPE')],
      ['getAirports', (s) => s.getAirports(['HND', 'FRA', 'NOPE'])],
      ['getCity', (s) => s.getCity('riyadh')],
      ['getCities', (s) => s.getCities(['london', 'x'])],
      ['findCityIds', (s) => s.findCityIds('lon')],
      ['getCountry', (s) => s.getCountry('SA')],
      ['getCountries', (s) => s.getCountries(['JP', 'GB'])],
      ['findCountryCodes', (s) => s.findCountryCodes('  germ ')],
      ['getCurrency', (s) => s.getCurrency('GBP')],
      ['listCurrencies', (s) => s.listCurrencies()],
      ['listAttractions', (s) => s.listAttractions('frankfurt')],
    ];
    for (const [name, call] of calls) {
      expect(await call(service), name).toEqual(
        await call(fake as unknown as ReferenceDataService),
      );
    }
  });
});
