import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { getPlatformCurrency } from '../../../common/money/platform-currency.js';
import { Airport } from '../schemas/airport.schema.js';
import { Attraction } from '../schemas/attraction.schema.js';
import { City } from '../schemas/city.schema.js';
import { Country } from '../schemas/country.schema.js';
import { Currency } from '../schemas/currency.schema.js';

/** Names and minor units of the supported currencies (data-model 3.1). */
const CURRENCY_TABLE: Record<string, { name: string; minorUnits: number }> = {
  EGP: { name: 'Egyptian Pound', minorUnits: 2 },
  AED: { name: 'UAE Dirham', minorUnits: 2 },
  GBP: { name: 'Pound Sterling', minorUnits: 2 },
  USD: { name: 'US Dollar', minorUnits: 2 },
  EUR: { name: 'Euro', minorUnits: 2 },
  JPY: { name: 'Japanese Yen', minorUnits: 0 },
  SAR: { name: 'Saudi Riyal', minorUnits: 2 },
};

const FILES = {
  countries: 'countries.csv',
  cities: 'cities.csv',
  airports: 'airports.csv',
  attractions: 'attractions.csv',
} as const;

const DEFAULT_SEED_DIR = fileURLToPath(
  new URL('../../../../seed-data/', import.meta.url),
);

export interface CollectionResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

export type SeedResult = Record<
  'currencies' | 'countries' | 'cities' | 'airports' | 'attractions',
  CollectionResult
>;

interface CsvRow {
  /** Line number in the file, for error messages. */
  line: number;
  values: Record<string, string>;
}

@Injectable()
export class ReferenceDataSeedService {
  private readonly logger = new Logger(ReferenceDataSeedService.name);

  constructor(
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<Attraction>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
  ) {}

  /**
   * Seeds the five reference collections from the CSVs in `dir`
   * (default: backend/seed-data). Validates everything before the first
   * write, then upserts by `_id`, so a re-run changes nothing.
   */
  async run(options: { dir?: string } = {}): Promise<SeedResult> {
    const dir = options.dir ?? DEFAULT_SEED_DIR;

    const countryRows = this.readCsv(dir, FILES.countries, [
      'code',
      'name',
      'currency',
    ]);
    const cityRows = this.readCsv(dir, FILES.cities, [
      'city_id',
      'name',
      'country_code',
    ]);
    const airportRows = this.readCsv(dir, FILES.airports, [
      'iata_code',
      'name',
      'city_id',
      'country_code',
      'time_zone',
    ]);
    const attractionRows = this.readCsv(dir, FILES.attractions, [
      'attraction_id',
      'name',
      'city_id',
    ]);

    const countryIds = this.uniqueIds(FILES.countries, countryRows, 'code');
    const cityIds = this.uniqueIds(FILES.cities, cityRows, 'city_id');
    this.uniqueIds(FILES.airports, airportRows, 'iata_code');
    this.uniqueIds(FILES.attractions, attractionRows, 'attraction_id');

    const currencyDocs = this.deriveCurrencies(countryRows);
    const currencyIds = new Set(currencyDocs.map((currency) => currency._id));

    this.checkReferences(
      FILES.countries,
      countryRows,
      'currency',
      currencyIds,
      'currencies',
    );
    this.checkReferences(
      FILES.cities,
      cityRows,
      'country_code',
      countryIds,
      'countries',
    );
    this.checkReferences(
      FILES.airports,
      airportRows,
      'city_id',
      cityIds,
      'cities',
    );
    this.checkReferences(
      FILES.airports,
      airportRows,
      'country_code',
      countryIds,
      'countries',
    );
    this.checkReferences(
      FILES.attractions,
      attractionRows,
      'city_id',
      cityIds,
      'cities',
    );

    const result: SeedResult = {
      currencies: await this.upsert(this.currencies, currencyDocs),
      countries: await this.upsert(
        this.countries,
        countryRows.map(({ values: v }) => ({
          _id: v.code,
          name: v.name,
          currency: v.currency,
        })),
      ),
      cities: await this.upsert(
        this.cities,
        cityRows.map(({ values: v }) => ({
          _id: v.city_id,
          name: v.name,
          countryCode: v.country_code,
        })),
      ),
      airports: await this.upsert(
        this.airports,
        airportRows.map(({ values: v }) => ({
          _id: v.iata_code,
          name: v.name,
          cityId: v.city_id,
          countryCode: v.country_code,
          timeZone: v.time_zone,
        })),
      ),
      attractions: await this.upsert(
        this.attractions,
        attractionRows.map(({ values: v }) => ({
          _id: v.attraction_id,
          name: v.name,
          cityId: v.city_id,
        })),
      ),
    };

    for (const [name, counts] of Object.entries(result)) {
      this.logger.log(
        `${name}: ${counts.inserted} inserted, ${counts.updated} updated, ${counts.unchanged} unchanged`,
      );
    }
    return result;
  }

  /** Reads a CSV exactly as written (no trimming) and checks its header. */
  private readCsv(dir: string, file: string, columns: string[]): CsvRow[] {
    const records = parse(readFileSync(join(dir, file), 'utf8'), {
      bom: true,
      columns: (header: string[]) => {
        for (const column of columns) {
          if (!header.includes(column)) {
            throw new Error(`${file}: missing column "${column}".`);
          }
        }
        return header;
      },
      skip_empty_lines: true,
      info: true,
    }) as { record: Record<string, string>; info: { lines: number } }[];
    return records.map(({ record, info }) => ({
      line: info.lines,
      values: record,
    }));
  }

  private uniqueIds(file: string, rows: CsvRow[], column: string): Set<string> {
    const ids = new Set<string>();
    for (const { line, values } of rows) {
      const id = values[column];
      if (ids.has(id)) {
        throw new Error(`${file} row ${line}: duplicate ${column} "${id}".`);
      }
      ids.add(id);
    }
    return ids;
  }

  private checkReferences(
    file: string,
    rows: CsvRow[],
    column: string,
    targetIds: Set<string>,
    target: string,
  ): void {
    for (const { line, values } of rows) {
      if (!targetIds.has(values[column])) {
        throw new Error(
          `${file} row ${line}: ${column} "${values[column]}" does not exist in ${target}.`,
        );
      }
    }
  }

  /** Distinct country currencies plus the platform currency, from the fixed table. */
  private deriveCurrencies(countryRows: CsvRow[]) {
    const codes = new Set([
      ...countryRows.map(({ values }) => values.currency),
      getPlatformCurrency(),
    ]);
    return [...codes].map((code) => {
      const entry = CURRENCY_TABLE[code];
      if (!entry) {
        throw new Error(
          `Currency "${code}" is not in the seed's currency table. Add its name and minor units before seeding.`,
        );
      }
      return { _id: code, name: entry.name, minorUnits: entry.minorUnits };
    });
  }

  private async upsert<T extends { _id: string }>(
    model: Model<any>,
    docs: T[],
  ): Promise<CollectionResult> {
    if (docs.length === 0) {
      return { inserted: 0, updated: 0, unchanged: 0 };
    }
    const result = await model.bulkWrite(
      docs.map(({ _id, ...fields }) => ({
        updateOne: { filter: { _id }, update: { $set: fields }, upsert: true },
      })),
    );
    return {
      inserted: result.upsertedCount,
      updated: result.modifiedCount,
      unchanged: result.matchedCount - result.modifiedCount,
    };
  }
}
