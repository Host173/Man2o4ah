import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { StorageService } from '../storage/storage.service.js';
import { AirlinesService } from './airlines.service.js';
import { FlightsModule } from './flights.module.js';
import { FlightsService } from './flights.service.js';
import { Airline } from './schemas/airline.schema.js';

describe('AirlinesService integration (FLT-01, ACC-15)', () => {
  let testApp: TestApp | undefined;
  let airlines: AirlinesService;
  let flights: FlightsService;
  let airlineModel: Model<Airline>;
  let storage: FakeStorageService;

  beforeAll(async () => {
    storage = new FakeStorageService();
    testApp = await createTestApp({
      imports: [FlightsModule],
      override: (builder) =>
        builder.overrideProvider(StorageService).useValue(storage),
    });
    airlines = testApp.moduleRef.get(AirlinesService);
    flights = testApp.moduleRef.get(FlightsService);
    airlineModel = testApp.moduleRef.get<Model<Airline>>(
      getModelToken(Airline.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    if (testApp) await clearCollections(testApp.connection);
  });

  afterAll(async () => {
    await testApp?.close();
  }, HOOK_TIMEOUT);

  it('creates a normalized active airline with the data-model policy defaults', async () => {
    const airline = await airlines.create({
      name: '  Cairo Air  ',
      code: 'ca',
    });

    expect(airline).toMatchObject({
      name: 'Cairo Air',
      code: 'CA',
      isActive: true,
      baggagePolicy: {
        extraBagPriceMinor: null,
        maxExtraBagsPerPassenger: 0,
      },
      cancellationTiers: [],
    });
    expect(await airlineModel.countDocuments()).toBe(1);
  });

  it('returns null for an unknown airline and enforces unique codes', async () => {
    await expect(airlines.getAirline('nope')).resolves.toBeNull();
    await expect(flights.getAirline('nope')).resolves.toBeNull();
    await expect(airlines.getAirline('000000000000000000000001')).resolves.toBe(
      null,
    );
    await airlines.create({ name: 'Cairo Air', code: 'CA' });

    await expect(
      airlines.create({ name: 'Another Airline', code: 'CA' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('edits only the moderator airline and returns 404 for another airline', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const user = {
      id: 'moderator',
      role: 'airline_moderator',
      providerId: airline.id,
      sid: 'session',
    } as const;

    await expect(
      airlines.update(airline.id, { name: 'Nile Air', code: 'na' }, user),
    ).resolves.toMatchObject({ name: 'Nile Air', code: 'NA' });
    await expect(
      airlines.update(
        airline.id,
        { name: 'Other' },
        {
          ...user,
          providerId: '000000000000000000000002',
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('sets active state idempotently and rejects an unknown airline', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });

    await expect(
      flights.setAirlineActive(airline.id, false),
    ).resolves.toMatchObject({
      id: airline.id,
      isActive: false,
    });
    await expect(
      flights.setAirlineActive(airline.id, false),
    ).resolves.toMatchObject({
      isActive: false,
    });
    await expect(
      flights.setAirlineActive('000000000000000000000001', true),
    ).rejects.toMatchObject({ status: 404 });
    await expect(flights.setAirlineActive('nope', false)).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it('rejects a missing extra-bag price in the service without changing the saved policy', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const moderator = await loginAs(
      testApp!.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: airline.id },
    );
    const policy = { extraBagPriceMinor: 2500, maxExtraBagsPerPassenger: 2 };
    await airlines.updateBaggagePolicy(airline.id, policy, moderator);

    await expect(
      airlines.updateBaggagePolicy(
        airline.id,
        { extraBagPriceMinor: null, maxExtraBagsPerPassenger: 1 },
        moderator,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [
          {
            field: 'extraBagPriceMinor',
            message: expect.any(String),
          },
        ],
      },
    });
    await expect(airlines.getAirline(airline.id)).resolves.toMatchObject({
      baggagePolicy: policy,
    });
    await expect(
      airlines.updateBaggagePolicy(
        airline.id,
        { extraBagPriceMinor: null, maxExtraBagsPerPassenger: 0 },
        moderator,
      ),
    ).resolves.toMatchObject({
      baggagePolicy: { extraBagPriceMinor: null, maxExtraBagsPerPassenger: 0 },
    });
  });

  it('replaces an airline logo and removes the old stored image', async () => {
    const airline = await airlines.create({ name: 'Cairo Air', code: 'CA' });
    const user = {
      id: 'moderator',
      role: 'airline_moderator',
      providerId: airline.id,
      sid: 'session',
    } as const;
    const image = (content: string) => ({
      buffer: Buffer.from(content),
      originalname: 'logo.png',
      mimetype: 'image/png',
      size: Buffer.byteLength(content),
    });

    const first = await airlines.updateLogo(airline.id, image('first'), user);
    const firstKey = storage.keys()[0];
    expect(first.logo?.url).toBe(`/uploads/${firstKey}`);

    const second = await airlines.updateLogo(airline.id, image('second'), user);
    expect(second.logo?.url).not.toBe(first.logo?.url);
    expect(storage.has(firstKey)).toBe(false);
    expect(await airlineModel.countDocuments()).toBe(1);
  });
});
