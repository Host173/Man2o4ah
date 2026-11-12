import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  AirportView,
  AttractionView,
  CityView,
  CountryView,
  CurrencyView,
} from './reference-data.types.js';

/**
 * Read-only access to the reference dataset (GEN-12). Every getter returns
 * `null`, or leaves the key out of the `Map`, when something isn't found: the
 * caller decides between 400 and 404.
 */
@Injectable()
export class ReferenceDataService {
  /** One airport by code, or `null` (GEN-12). Implemented in GEN-12. */
  getAirport(code: string): Promise<AirportView | null> {
    void code;
    throw new NotImplementedException('getAirport: implemented in GEN-12');
  }

  /** Airports by code, for lists; unknown codes are left out (GEN-12). Implemented in GEN-12. */
  getAirports(codes: string[]): Promise<Map<string, AirportView>> {
    void codes;
    throw new NotImplementedException('getAirports: implemented in GEN-12');
  }

  /** One city by ID, or `null` (GEN-12). Implemented in GEN-12. */
  getCity(id: string): Promise<CityView | null> {
    void id;
    throw new NotImplementedException('getCity: implemented in GEN-12');
  }

  /** Cities by ID, for lists; unknown IDs are left out (GEN-12). Implemented in GEN-12. */
  getCities(ids: string[]): Promise<Map<string, CityView>> {
    void ids;
    throw new NotImplementedException('getCities: implemented in GEN-12');
  }

  /** IDs of the cities whose name matches the escaped keyword, case-insensitive (ITN-21). Implemented in GEN-12. */
  findCityIds(keyword: string): Promise<string[]> {
    void keyword;
    throw new NotImplementedException('findCityIds: implemented in GEN-12');
  }

  /** One country by code, or `null` (GEN-12). Implemented in GEN-12. */
  getCountry(code: string): Promise<CountryView | null> {
    void code;
    throw new NotImplementedException('getCountry: implemented in GEN-12');
  }

  /** Countries by code, for lists; unknown codes are left out (GEN-12). Implemented in GEN-12. */
  getCountries(codes: string[]): Promise<Map<string, CountryView>> {
    void codes;
    throw new NotImplementedException('getCountries: implemented in GEN-12');
  }

  /** Codes of the countries whose name matches the escaped keyword, case-insensitive (ITN-21). Implemented in GEN-12. */
  findCountryCodes(keyword: string): Promise<string[]> {
    void keyword;
    throw new NotImplementedException(
      'findCountryCodes: implemented in GEN-12',
    );
  }

  /** One currency by code, or `null` (GEN-12). Implemented in GEN-12. */
  getCurrency(code: string): Promise<CurrencyView | null> {
    void code;
    throw new NotImplementedException('getCurrency: implemented in GEN-12');
  }

  /** Every currency, sorted by code (GEN-12). Implemented in GEN-12. */
  listCurrencies(): Promise<CurrencyView[]> {
    throw new NotImplementedException('listCurrencies: implemented in GEN-12');
  }

  /** The attractions of a city, sorted by name (GEN-12). Implemented in GEN-12. */
  listAttractions(cityId: string): Promise<AttractionView[]> {
    void cityId;
    throw new NotImplementedException('listAttractions: implemented in GEN-12');
  }
}
