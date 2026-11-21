import { rmSync } from 'node:fs';
import { Types } from 'mongoose';
import {
  createFlight,
  holdFlight,
  startPayment,
  statusOf,
} from './support/flows.js';
import {
  createStressApp,
  eventually,
  Findings,
  probeRunner,
  type Stress,
} from './support/stress-app.js';

/**
 * TST-03 area I: restart safety. The first app is closed in the middle of a
 * flow; a fresh app on the same database must finish it.
 */
describe('stress I: restart safety', () => {
  let first: Stress;
  let second: Stress;
  const findings = new Findings('restart');
  const probe = probeRunner(() => second, findings);
  const oid = (id: string) => new Types.ObjectId(id);

  beforeAll(async () => {
    first = await createStressApp();
  });
  afterAll(async () => {
    findings.write();
    await second?.close();
    await first?.mongo.stop();
    if (first) rmSync(first.uploadDir, { recursive: true, force: true });
  });

  it('I1 a hold and a started payment survive a restart', async () => {
    const mod = await first.as(first.world.airlines.NA.moderator);
    const flight = await createFlight(first, mod, { seats: 4 });
    const user = await first.newUser('i1');
    const paidId = (await holdFlight(user, flight)).body.bookingId as string;
    const paid = await startPayment(first, user, 'flight', paidId);
    const lateId = (await holdFlight(user, flight)).body.bookingId as string;
    const late = await startPayment(first, user, 'flight', lateId);
    // Model write (test-only): the second hold is already over.
    await first
      .col('flight_bookings')
      .updateOne(
        { _id: oid(lateId) },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
    // The process stops in the middle of both flows (the database stays).
    await first.t.app.close();
    second = await createStressApp({
      mongo: first.mongo,
      uploadDir: first.uploadDir,
      seed: false,
    });

    await probe('I1 restart in the middle of a flow', async (check) => {
      const ran = new Date();
      await second.jobs.flightExpiry(ran);
      check(
        'the overdue hold expires on schedule after the restart',
        await statusOf(second, 'flight', lateId),
        (await statusOf(second, 'flight', lateId)) === 'expired',
      );
      await second.payWebhook(paid.paymentIntentId);
      const confirmed = await eventually(async () =>
        (await statusOf(second, 'flight', paidId)) === 'confirmed'
          ? 'confirmed'
          : '',
      );
      check(
        "the old payment's webhook still confirms",
        confirmed,
        confirmed === 'confirmed',
      );
      await second.payWebhook(late.paymentIntentId);
      const refund = await eventually(() =>
        second.col('refunds').findOne({ bookingId: oid(lateId) }),
      );
      check(
        "the expired hold's late payment is refunded",
        refund?.reason,
        refund?.reason === 'late_payment',
      );
      const broken = await second.invariants({ expiryRanAt: ran });
      check('nothing is stuck', broken, broken.length === 0);
    });
  });

  it('I2 every declared unique index exists in the live database', async () => {
    await probe('I2 live unique indexes', async (check) => {
      const missing: string[] = [];
      for (const model of Object.values(second.t.connection.models)) {
        const live = await model.collection.indexes();
        for (const [keys, options] of model.schema.indexes()) {
          if (!options?.unique) continue;
          const wanted = JSON.stringify(keys);
          const found = live.some(
            (index) =>
              JSON.stringify(index.key) === wanted && index.unique === true,
          );
          if (!found) missing.push(`${model.collection.name} ${wanted}`);
        }
      }
      check(
        'every unique index of the schemas is live after a fresh start',
        missing,
        missing.length === 0,
      );
    });
  });

  it('records no unhandled rejection', () => {
    expect([...first.unhandled, ...second.unhandled]).toEqual([]);
  });
});
