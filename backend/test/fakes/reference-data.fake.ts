import { keywordRegex } from '../../src/common/text/escape-regex.js';
import type { ReferenceDataService } from '../../src/modules/reference-data/reference-data.service.js';
import type {
  AirportView,
  AttractionView,
  CityView,
  CountryView,
  CurrencyView,
} from '../../src/modules/reference-data/reference-data.types.js';
import type { PublicApi } from './public-api.js';

export interface ReferenceDataset {
  airports: AirportView[];
  cities: CityView[];
  countries: CountryView[];
  currencies: CurrencyView[];
  attractions: AttractionView[];
}

const DEFAULT_DATASET: ReferenceDataset = {
  airports: [
    {
      code: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    },
    {
      code: 'DXB',
      name: 'Dubai International Airport',
      cityId: 'dubai',
      countryCode: 'AE',
      timeZone: 'Asia/Dubai',
    },
    {
      code: 'JFK',
      name: 'John F. Kennedy International Airport',
      cityId: 'new_york',
      countryCode: 'US',
      timeZone: 'America/New_York',
    },
  ],
  cities: [
    { id: 'cairo', name: 'Cairo', countryCode: 'EG' },
    { id: 'dubai', name: 'Dubai', countryCode: 'AE' },
    { id: 'new_york', name: 'New York', countryCode: 'US' },
  ],
  countries: [
    { code: 'EG', name: 'Egypt', currency: 'EGP' },
    { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
    { code: 'US', name: 'United States', currency: 'USD' },
  ],
  currencies: [
    { code: 'USD', name: 'US Dollar', minorUnits: 2 },
    { code: 'EGP', name: 'Egyptian Pound', minorUnits: 2 },
    { code: 'AED', name: 'UAE Dirham', minorUnits: 2 },
    { code: 'EUR', name: 'Euro', minorUnits: 2 },
    { code: 'JPY', name: 'Japanese Yen', minorUnits: 0 },
  ],
  attractions: [
    { id: 'att-1', name: 'Pyramids of Giza', cityId: 'cairo' },
    { id: 'att-2', name: 'Egyptian Museum', cityId: 'cairo' },
    { id: 'att-3', name: 'Burj Khalifa', cityId: 'dubai' },
  ],
};

function byKey<T>(items: T[], key: (item: T) => string, keys: string[]) {
  const wanted = new Set(keys);
  return new Map(
    items.filter((item) => wanted.has(key(item))).map((i) => [key(i), i]),
  );
}

/** A working `ReferenceDataService` over a small built-in dataset, replaceable through the constructor. */
export class FakeReferenceDataService implements PublicApi<ReferenceDataService> {
  private readonly data: ReferenceDataset;

  constructor(dataset: Partial<ReferenceDataset> = {}) {
    this.data = { ...DEFAULT_DATASET, ...dataset };
  }

  getAirport(code: string): Promise<AirportView | null> {
    return Promise.resolve(
      this.data.airports.find((a) => a.code === code) ?? null,
    );
  }

  getAirports(codes: string[]): Promise<Map<string, AirportView>> {
    return Promise.resolve(byKey(this.data.airports, (a) => a.code, codes));
  }

  getCity(id: string): Promise<CityView | null> {
    return Promise.resolve(this.data.cities.find((c) => c.id === id) ?? null);
  }

  getCities(ids: string[]): Promise<Map<string, CityView>> {
    return Promise.resolve(byKey(this.data.cities, (c) => c.id, ids));
  }

  findCityIds(keyword: string): Promise<string[]> {
    const regex = keywordRegex(keyword);
    return Promise.resolve(
      this.data.cities.filter((c) => regex.test(c.name)).map((c) => c.id),
    );
  }

  getCountry(code: string): Promise<CountryView | null> {
    return Promise.resolve(
      this.data.countries.find((c) => c.code === code) ?? null,
    );
  }

  getCountries(codes: string[]): Promise<Map<string, CountryView>> {
    return Promise.resolve(byKey(this.data.countries, (c) => c.code, codes));
  }

  findCountryCodes(keyword: string): Promise<string[]> {
    const regex = keywordRegex(keyword);
    return Promise.resolve(
      this.data.countries.filter((c) => regex.test(c.name)).map((c) => c.code),
    );
  }

  getCurrency(code: string): Promise<CurrencyView | null> {
    return Promise.resolve(
      this.data.currencies.find((c) => c.code === code) ?? null,
    );
  }

  listCurrencies(): Promise<CurrencyView[]> {
    return Promise.resolve(
      [...this.data.currencies].sort((a, b) => a.code.localeCompare(b.code)),
    );
  }

  listAttractions(cityId: string): Promise<AttractionView[]> {
    return Promise.resolve(
      this.data.attractions
        .filter((a) => a.cityId === cityId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
}
