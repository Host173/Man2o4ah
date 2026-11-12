/** An airport as other modules see it; `code` is the IATA code (GEN-12). */
export interface AirportView {
  code: string;
  name: string;
  cityId: string;
  countryCode: string;
  timeZone: string;
}

/** A city as other modules see it (GEN-12). */
export interface CityView {
  id: string;
  name: string;
  countryCode: string;
}

/** A country as other modules see it; `currency` is its currency code (GEN-12). */
export interface CountryView {
  code: string;
  name: string;
  currency: string;
}

/** A currency as other modules see it (GEN-12). */
export interface CurrencyView {
  code: string;
  name: string;
  minorUnits: number;
}

/** An attraction as other modules see it (GEN-12). */
export interface AttractionView {
  id: string;
  name: string;
  cityId: string;
}
