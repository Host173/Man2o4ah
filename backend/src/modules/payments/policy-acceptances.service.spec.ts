import { Types } from 'mongoose';
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
