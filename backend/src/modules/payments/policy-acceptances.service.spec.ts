import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakePayableBooking } from '../../../test/fakes/payable-booking.fake.js';
import { FakeStripeGateway } from '../../../test/fakes/stripe-gateway.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { PaymentsModule } from './payments.module.js';
import { PolicyAcceptancesService } from './policy-acceptances.service.js';
import { PayableBookingRegistry } from './ports/payable-booking.registry.js';
import type { PolicyAcceptance } from './schemas/policy-acceptance.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

describe('PolicyAcceptancesService (PAY-02)', () => {
  let t: TestApp;
  const hotels = new FakePayableBooking(BookingType.HOTEL);

  beforeAll(async () => {
    t = await createTestApp({
      imports: [PaymentsModule],
      override: (builder) =>
        builder
          .overrideProvider(STRIPE_GATEWAY)
          .useValue(new FakeStripeGateway()),
    });
    t.moduleRef.get(PayableBookingRegistry).register(hotels);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  it('refuses policies of the wrong kind: a wiring bug, not a client error', async () => {
    const userId = new Types.ObjectId().toHexString();
    const bookingId = new Types.ObjectId().toHexString();
    // A hotel implementer that returns flight policies.
    hotels.set(
      bookingId,
      userId,
      {
        amountMinor: 100,
        currency: 'USD',
        status: 'pending_payment',
        holdExpiresAt: new Date(Date.now() + 60_000),
      },
      { bookingType: 'flight', segments: [] },
    );

    await expect(
      t.moduleRef
        .get(PolicyAcceptancesService)
        .getPolicies(userId, BookingType.HOTEL, bookingId),
    ).rejects.toThrow(/returned "flight" policies/);
  });
});

describe('PolicyAcceptancesService.accept: racing upserts (PAY-02)', () => {
  const userId = new Types.ObjectId().toHexString();
  const bookingId = new Types.ObjectId().toHexString();
  const FIRST = new Date('2027-01-01T10:00:00.000Z');

  /** A service over a stub model: `upsert` and `find` are what the two queries resolve to. */
  function serviceWith(
    upsert: () => Promise<unknown>,
    find: () => Promise<unknown>,
  ): PolicyAcceptancesService {
    const model = {
      findOneAndUpdate: () => ({ lean: upsert }),
      findOne: () => ({ lean: find }),
    } as unknown as Model<PolicyAcceptance>;
    const registry = new PayableBookingRegistry();
    const hotels = new FakePayableBooking(BookingType.HOTEL);
    hotels.set(
      bookingId,
      userId,
      {
        amountMinor: 100,
        currency: 'USD',
        status: 'pending_payment',
        holdExpiresAt: new Date(Date.now() + 60_000),
      },
      {
        bookingType: 'hotel',
        cancellationTiers: [],
        checkInTime: '14:00',
        checkOutTime: '11:00',
      },
    );
    registry.register(hotels);
    return new PolicyAcceptancesService(model, registry);
  }

  it('returns the winner’s acceptance when the upsert hits the unique index', async () => {
    const service = serviceWith(
      () => Promise.reject(Object.assign(new Error('E11000'), { code: 11000 })),
      () => Promise.resolve({ acceptedAt: FIRST }),
    );

    await expect(
      service.accept(userId, BookingType.HOTEL, bookingId),
    ).resolves.toEqual({
      bookingType: 'hotel',
      bookingId,
      accepted: true,
      acceptedAt: FIRST,
    });
  });

  it('rethrows any other database error', async () => {
    const boom = new Error('connection lost');
    const service = serviceWith(
      () => Promise.reject(boom),
      () => Promise.resolve({ acceptedAt: FIRST }),
    );

    await expect(
      service.accept(userId, BookingType.HOTEL, bookingId),
    ).rejects.toBe(boom);
  });

  it('throws a plain error when the acceptance cannot be found after the race', async () => {
    const service = serviceWith(
      () => Promise.reject(Object.assign(new Error('E11000'), { code: 11000 })),
      () => Promise.resolve(null),
    );

    await expect(
      service.accept(userId, BookingType.HOTEL, bookingId),
    ).rejects.toThrow(/not found after saving/);
  });
});
