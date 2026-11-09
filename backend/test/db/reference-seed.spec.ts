import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { parse } from 'csv-parse/sync';
import type { Connection } from 'mongoose';
import { ReferenceDataModule } from '../../src/modules/reference-data/reference-data.module.js';
import { ReferenceDataSeedService } from '../../src/modules/reference-data/seed/reference-data-seed.service.js';
import {
  HOOK_TIMEOUT,
  startMemoryMongo,
  type MemoryMongo,
} from '../support/mongo-memory.js';

const SEED_DIR = join(import.meta.dirname, '../../seed-data');
const COLLECTIONS = [
  'countries',
  'cities',
  'airports',
  'attractions',
  'currencies',
] as const;

function csvIds(file: string): string[] {
  const rows = parse(readFileSync(join(SEED_DIR, file), 'utf8'), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
  return rows.map((row) => Object.values(row)[0]);
}

describe('reference-data seed', () => {
  let mongo: MemoryMongo;
  let connection: Connection;
  let seed: ReferenceDataSeedService;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    Logger.overrideLogger(false);
    mongo = await startMemoryMongo();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.uri, { dbName: 'reference' }),
        ReferenceDataModule,
      ],
    }).compile();
    await moduleRef.init();
    connection = moduleRef.get<Connection>(getConnectionToken());
    seed = moduleRef.get(ReferenceDataSeedService, { strict: false });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await connection.close();
    await mongo.stop();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    for (const name of COLLECTIONS) {
      await connection.collection(name).deleteMany({});
    }
  });

  async function ids(collection: string): Promise<string[]> {
    const docs = await connection
      .collection<{ _id: string }>(collection)
      .find()
      .toArray();
    return docs.map((doc) => doc._id).sort();
  }

  /** Copies the real CSVs into a temp dir so a test can change them. */
  function fixtureDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'seed-fixture-'));
    tempDirs.push(dir);
    for (const file of ['countries', 'cities', 'airports', 'attractions']) {
      copyFileSync(join(SEED_DIR, `${file}.csv`), join(dir, `${file}.csv`));
    }
    return dir;
  }

  it('imports every CSV row with the CSV ID as _id, and 7 currencies', async () => {
    await seed.run();

    expect(await ids('countries')).toEqual(csvIds('countries.csv').sort());
    expect(await ids('cities')).toEqual(csvIds('cities.csv').sort());
    expect(await ids('airports')).toEqual(csvIds('airports.csv').sort());
    expect(await ids('attractions')).toEqual(csvIds('attractions.csv').sort());
    expect(await ids('currencies')).toEqual([
      'AED',
      'EGP',
      'EUR',
      'GBP',
      'JPY',
      'SAR',
      'USD',
    ]);

    expect(
      await connection
        .collection('currencies')
        .findOne({ _id: 'JPY' as never }),
    ).toEqual({ _id: 'JPY', name: 'Japanese Yen', minorUnits: 0 });
    expect(
      await connection.collection('airports').findOne({ _id: 'CAI' as never }),
    ).toEqual({
      _id: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    });
  });

  it('a second run inserts, updates and changes nothing', async () => {
    await seed.run();
    const before = Object.fromEntries(
      await Promise.all(
        COLLECTIONS.map(
          async (name) =>
            [name, await connection.collection(name).countDocuments()] as const,
        ),
      ),
    );

    const second = await seed.run();

    for (const name of COLLECTIONS) {
      expect(second[name].inserted).toBe(0);
      expect(second[name].updated).toBe(0);
      expect(second[name].unchanged).toBe(before[name]);
      expect(await connection.collection(name).countDocuments()).toBe(
        before[name],
      );
    }
  });

  it('throws on a broken reference and writes nothing', async () => {
    const dir = fixtureDir();
    const airports = readFileSync(join(dir, 'airports.csv'), 'utf8');
    writeFileSync(
      join(dir, 'airports.csv'),
      `${airports.trimEnd()}\nXXX,Nowhere Airport,atlantis,EG,Africa/Cairo\n`,
    );

    await expect(seed.run({ dir })).rejects.toThrow(
      /airports\.csv row 10: city_id "atlantis" does not exist in cities/,
    );
    for (const name of COLLECTIONS) {
      expect(await connection.collection(name).countDocuments()).toBe(0);
    }
  });

  it('stops on a currency missing from the fixed table, naming it', async () => {
    const dir = fixtureDir();
    const countries = readFileSync(join(dir, 'countries.csv'), 'utf8');
    writeFileSync(
      join(dir, 'countries.csv'),
      `${countries.trimEnd()}\nCH,Switzerland,CHF\n`,
    );

    await expect(seed.run({ dir })).rejects.toThrow(/"CHF"/);
    for (const name of COLLECTIONS) {
      expect(await connection.collection(name).countDocuments()).toBe(0);
    }
  });

  it('updates a changed row and leaves the others unchanged', async () => {
    await seed.run();
    const dir = fixtureDir();
    const cities = readFileSync(join(dir, 'cities.csv'), 'utf8');
    writeFileSync(
      join(dir, 'cities.csv'),
      cities.replace('Cairo,EG', 'Al-Qahira,EG'),
    );

    const result = await seed.run({ dir });

    expect(result.cities.updated).toBe(1);
    expect(result.cities.inserted).toBe(0);
    expect(result.countries.updated).toBe(0);
    expect(
      await connection.collection('cities').findOne({ _id: 'cairo' as never }),
    ).toMatchObject({ name: 'Al-Qahira' });
  });
});
