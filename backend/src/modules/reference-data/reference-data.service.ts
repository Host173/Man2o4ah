import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { keywordRegex } from '../../common/text/escape-regex.js';
import type {
  AirportView,
  AttractionView,
  CityView,
  CountryView,
  CurrencyView,
} from './reference-data.types.js';
import { Airport } from './schemas/airport.schema.js';
import { Attraction } from './schemas/attraction.schema.js';
import { City } from './schemas/city.schema.js';
import { Country } from './schemas/country.schema.js';
import { Currency } from './schemas/currency.schema.js';

const toAirport = (a: Airport): AirportView => ({
  code: a._id,
  name: a.name,
  cityId: a.cityId,
  countryCode: a.countryCode,
  timeZone: a.timeZone,
});
const toCity = (c: City): CityView => ({
  id: c._id,
  name: c.name,
  countryCode: c.countryCode,
});
const toCountry = (c: Country): CountryView => ({
  code: c._id,
  name: c.name,
  currency: c.currency,
});
const toCurrency = (c: Currency): CurrencyView => ({
  code: c._id,
  name: c.name,
  minorUnits: c.minorUnits,
});
const toAttraction = (a: Attraction): AttractionView => ({
  id: a._id,
  name: a.name,
  cityId: a.cityId,
});

/**
 * Read-only lookups over the reference datasets (GEN-12), for other modules.
 * Every getter returns `null`, or leaves the key out of the `Map`, when
 * something isn't found: the caller decides between 400 and 404.
 */
@Injectable()
export class ReferenceDataService {
  constructor(
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<Attraction>,
  ) {}

  async getAirport(code: string): Promise<AirportView | null> {
    const airport = await this.airports.findById(code).lean<Airport>();
    return airport ? toAirport(airport) : null;
  }

  async getAirports(codes: string[]): Promise<Map<string, AirportView>> {
    const found = await this.byIds(this.airports, codes);
    return new Map(found.map((a) => [a._id, toAirport(a)]));
  }

  /** All airports in a city (ITN-26); empty when the city has none. */
  async getAirportsByCity(cityId: string): Promise<AirportView[]> {
    const found = await this.airports.find({ cityId }).lean<Airport[]>();
    return found.map(toAirport);
  }

  async getCity(id: string): Promise<CityView | null> {
    const city = await this.cities.findById(id).lean<City>();
    return city ? toCity(city) : null;
  }

  async getCities(ids: string[]): Promise<Map<string, CityView>> {
    const found = await this.byIds(this.cities, ids);
    return new Map(found.map((c) => [c._id, toCity(c)]));
  }

  /** IDs of the cities whose name contains `keyword`, case-insensitive (ITN-21). */
  async findCityIds(keyword: string): Promise<string[]> {
    const found = await this.cities
      .find({ name: keywordRegex(keyword) }, { _id: 1 })
      .lean<Pick<City, '_id'>[]>();
    return found.map((c) => c._id);
  }

  async getCountry(code: string): Promise<CountryView | null> {
    const country = await this.countries.findById(code).lean<Country>();
    return country ? toCountry(country) : null;
  }

  async getCountries(codes: string[]): Promise<Map<string, CountryView>> {
    const found = await this.byIds(this.countries, codes);
    return new Map(found.map((c) => [c._id, toCountry(c)]));
  }

  /** Codes of the countries whose name contains `keyword`, case-insensitive (ITN-21). */
  async findCountryCodes(keyword: string): Promise<string[]> {
    const found = await this.countries
      .find({ name: keywordRegex(keyword) }, { _id: 1 })
      .lean<Pick<Country, '_id'>[]>();
    return found.map((c) => c._id);
  }

  async getCurrency(code: string): Promise<CurrencyView | null> {
    const currency = await this.currencies.findById(code).lean<Currency>();
    return currency ? toCurrency(currency) : null;
  }

  /** Every supported currency, sorted by code. */
  async listCurrencies(): Promise<CurrencyView[]> {
    const found = await this.currencies
      .find()
      .sort({ _id: 1 })
      .lean<Currency[]>();
    return found.map(toCurrency);
  }

  /** The attractions of a city, sorted by name; empty for an unknown city. */
  async listAttractions(cityId: string): Promise<AttractionView[]> {
    const found = await this.attractions
      .find({ cityId })
      .sort({ name: 1, _id: 1 })
      .lean<Attraction[]>();
    return found.map(toAttraction);
  }

  private byIds<T extends { _id: string }>(
    model: Model<T>,
    ids: string[],
  ): Promise<T[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return model
      .find({ _id: { $in: [...new Set(ids)] } })
      .lean<T[]>()
      .exec();
  }
}
