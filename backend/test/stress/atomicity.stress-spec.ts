import { readdirSync } from 'node:fs';
import { Types } from 'mongoose';
import { vi } from 'vitest';
import { FlightsService } from '../../src/modules/flights/flights.service.js';
import { SeatInventory } from '../../src/modules/flights/seat-inventory.js';
import { RoomNightInventory } from '../../src/modules/hotels/room-night-inventory.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import {
  confirmedFlightBooking,
  createFlight,
  createRoom,
  holdFlight,
  holdRoom,
  isErrorShape,
  startPayment,
  statusOf,
} from './support/flows.js';
import {
  createStressApp,
  dateIn,
  Findings,
  probeRunner,
  settle,
  type Stress,
} from './support/stress-app.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200),
]);
const boom = () => new Error('boom (TST-03 injected failure)');

/**
 * TST-03 area F: the second internal step of each multi-step write fails
 * once. The request must fail cleanly, leave nothing of the first step, keep
 * the invariants, and succeed when repeated; the process keeps serving.
 */
describe('stress F: partial failures inside one operation', () => {
  let s: Stress;
  const findings = new Findings('atomicity');
  const probe = probeRunner(() => s, findings);
  const oid = (id: string) => new Types.ObjectId(id);
  const get = <T>(token: new (...args: never[]) => T): T =>
    s.t.moduleRef.get(token, { strict: false });

  beforeAll(async () => {
    s = await createStressApp();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    findings.write();
    await s?.close();
  });

  it('F1 flight hold: the booking insert fails after the seats are held', async () => {
    await probe('F1 flight hold', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 2 });
      const user = await s.newUser('f1');
      vi.spyOn(
        s.t.connection.models.FlightBooking,
        'create',
      ).mockRejectedValueOnce(boom());
      const failed = await holdFlight(user, flight);
      check(
        'fails cleanly (5xx in the error shape)',
        failed.status,
        failed.status >= 500 && isErrorShape(failed.body),
      );
      const cabin = (await s
        .col('flights')
        .findOne({ _id: oid(flight.flightId) }))!.cabins[0];
      check(
        'no seat stays held',
        cabin.heldSeats,
        cabin.heldSeats === 0 && cabin.availableSeats === 2,
      );
      const again = await holdFlight(user, flight);
      check(
        'the same request succeeds afterwards',
        again.status,
        again.status === 201,
      );
    });
  });

  it('F2 hotel hold: the nights fail after the reservation is written', async () => {
    await probe('F2 hotel hold', async (check) => {
      const hotel = s.world.hotels['Nile View Hotel'];
      const roomId = await createRoom(await s.as(hotel.moderator), hotel.id);
      const user = await s.newUser('f2');
      vi.spyOn(get(RoomNightInventory), 'reserve').mockRejectedValueOnce(
        boom(),
      );
      const failed = await holdRoom(
        user,
        hotel.id,
        [roomId],
        dateIn(20),
        dateIn(22),
      );
      check(
        'fails cleanly',
        failed.status,
        failed.status >= 500 && isErrorShape(failed.body),
      );
      const left = await s
        .col('hotel_reservations')
        .countDocuments({ userId: oid(user.id) });
      check('no reservation left behind', left, left === 0);
      const again = await holdRoom(
        user,
        hotel.id,
        [roomId],
        dateIn(20),
        dateIn(22),
      );
      check(
        'the same request succeeds afterwards',
        again.status,
        again.status === 201,
      );
    });
  });

  it('F3 confirmation: booking the seats fails after the payment succeeded', async () => {
    await probe('F3 confirmation', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 2 });
      const user = await s.newUser('f3');
      const bookingId = (await holdFlight(user, flight)).body
        .bookingId as string;
      const started = await startPayment(s, user, 'flight', bookingId);
      vi.spyOn(get(SeatInventory), 'confirm').mockRejectedValueOnce(boom());
      const hook = await s.payWebhook(started.paymentIntentId);
      await settle(400);
      check('the webhook answers', hook.status, hook.status < 500);
      const status = await statusOf(s, 'flight', bookingId);
      check(
        'the status change rolled back with the seats (still pending)',
        status,
        status === 'pending_payment',
      );
      // What happens to the money afterwards is finding S-07.
    });
  });

  it('F4 user cancellation: returning the seats fails after the status change', async () => {
    await probe('F4 cancellation', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, {
        seats: 2,
        departureAt: new Date(Date.now() + 40 * 86_400_000),
      });
      const user = await s.newUser('f4');
      const { bookingId } = await confirmedFlightBooking(s, user, flight);
      vi.spyOn(get(SeatInventory), 'returnBooked').mockRejectedValueOnce(
        boom(),
      );
      const failed = await user.post(
        `/flight-bookings/${bookingId}/cancel`,
        {},
      );
      check(
        'fails cleanly',
        failed.status,
        failed.status >= 500 && isErrorShape(failed.body),
      );
      check(
        'still confirmed, no refund',
        [
          await statusOf(s, 'flight', bookingId),
          await s.col('refunds').countDocuments({ bookingId: oid(bookingId) }),
        ],
        (await statusOf(s, 'flight', bookingId)) === 'confirmed' &&
          (await s
            .col('refunds')
            .countDocuments({ bookingId: oid(bookingId) })) === 0,
      );
      const again = await user.post(`/flight-bookings/${bookingId}/cancel`, {});
      check(
        'the same request succeeds afterwards',
        again.status,
        again.status >= 200 && again.status < 300,
      );
    });
  });

  it("F5 provider flight cancellation: one booking's seat return fails", async () => {
    await probe('F5 provider cancellation', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, {
        seats: 5,
        departureAt: new Date(Date.now() + 40 * 86_400_000),
      });
      const users = [await s.newUser('f5a'), await s.newUser('f5b')];
      const ids = [];
      for (const u of users)
        ids.push((await confirmedFlightBooking(s, u, flight)).bookingId);
      vi.spyOn(get(SeatInventory), 'returnBooked').mockRejectedValueOnce(
        boom(),
      );
      const cancel = await mod.post(`/flights/${flight.flightId}/cancel`, {});
      check(
        'the flight cancel itself answers',
        cancel.status,
        cancel.status < 500,
      );
      await settle(1_000);
      const statuses = await Promise.all(
        ids.map((id) => statusOf(s, 'flight', id)),
      );
      // The failed booking is never retried: finding S-08. The other one
      // must still be handled.
      check(
        'the booking that did not fail is cancelled',
        statuses,
        statuses.includes('cancelled'),
      );
    });
  });

  // Not attacked: the probe could not attach activity images (400), see the report.
  it.skip('F6 itinerary clone: copying the second image fails', async () => {
    await probe('F6 clone with images', async (check) => {
      const owner = await s.newUser('f6-owner');
      const cloner = await s.newUser('f6-cloner');
      const it = await owner.post('/itineraries', {
        title: 'Pics trip',
        countryCodes: ['EG'],
        startDate: dateIn(5),
      });
      const day = await owner.post(`/itineraries/${it.body._id}/days`, {
        cityId: 'cairo',
      });
      const dayId = (day.body.days ?? []).at(-1)?._id;
      const act = await owner.post(
        `/itineraries/${it.body._id}/days/${dayId}/activities`,
        { name: 'Pyramids' },
      );
      void act;
      // Probe correction: read the activity id from the itinerary itself.
      const activityId = (
        await s.col('itineraries').findOne({ _id: oid(it.body._id) })
      )?.days
        .at(-1)
        ?.activities.at(-1)
        ?._id.toHexString();
      for (const name of ['a.png', 'b.png']) {
        await owner
          .req('post', `/activities/${activityId}/images`)
          .attach('file', PNG, name);
      }
      await owner.patch(`/itineraries/${it.body._id}`, {
        visibility: 'public',
      });
      const filesBefore = readdirSync(s.t.uploadDir).length;
      const storage = get(StorageService);
      const real = storage.copy.bind(storage);
      let calls = 0;
      vi.spyOn(storage, 'copy').mockImplementation(async (key: string) => {
        calls += 1;
        if (calls === 2) throw boom();
        return real(key);
      });
      const failed = await cloner.post(`/itineraries/${it.body._id}/clone`, {});
      check(
        'fails cleanly',
        `${failed.status} ${failed.body.code}`,
        failed.status >= 400 && isErrorShape(failed.body),
      );
      const clones = await s
        .col('itineraries')
        .countDocuments({ ownerId: oid(cloner.id) });
      check('no half clone left', clones, clones === 0);
      await settle(300);
      check(
        'no orphan copied files',
        readdirSync(s.t.uploadDir).length - filesBefore,
        readdirSync(s.t.uploadDir).length === filesBefore,
      );
      vi.restoreAllMocks();
      const again = await cloner.post(`/itineraries/${it.body._id}/clone`, {});
      check(
        'the same request succeeds afterwards',
        again.status,
        again.status === 201,
      );
    });
  });

  it('F7 room delete and deactivate: the inventory step fails', async () => {
    await probe('F7 room delete/deactivate', async (check) => {
      const hotel = s.world.hotels['Thames Court'];
      const mod = await s.as(hotel.moderator);
      const roomId = await createRoom(mod, hotel.id);
      vi.spyOn(get(RoomNightInventory), 'deactivate').mockRejectedValueOnce(
        boom(),
      );
      const off = await mod.patch(`/hotels/${hotel.id}/rooms/${roomId}`, {
        isActive: false,
      });
      const room = await s.col('rooms').findOne({ _id: oid(roomId) });
      check(
        'deactivate fails cleanly, room still active',
        [off.status, room?.isActive],
        off.status >= 400 && isErrorShape(off.body) && room?.isActive === true,
      );
      const offAgain = await mod.patch(`/hotels/${hotel.id}/rooms/${roomId}`, {
        isActive: false,
      });
      check(
        'deactivate succeeds afterwards',
        offAgain.status,
        offAgain.status === 200,
      );
      const other = await createRoom(mod, hotel.id);
      vi.spyOn(get(RoomNightInventory), 'delete').mockRejectedValueOnce(boom());
      const del = await mod.del(`/hotels/${hotel.id}/rooms/${other}`);
      const still = await s.col('rooms').countDocuments({ _id: oid(other) });
      check(
        'delete fails cleanly, room still there',
        [del.status, still],
        del.status >= 400 && still === 1,
      );
      const delAgain = await mod.del(`/hotels/${hotel.id}/rooms/${other}`);
      check(
        'delete succeeds afterwards',
        delAgain.status,
        delAgain.status < 300,
      );
    });
  });

  it('F8 provider deactivation: setting the airline inactive fails', async () => {
    await probe('F8 provider deactivation', async (check) => {
      const admin = await s.as('admin@example.com');
      const airlineId = s.world.airlines.EC.id;
      const notesBefore = await s
        .col('notifications')
        .countDocuments({ type: 'provider_deactivated' });
      vi.spyOn(get(FlightsService), 'setAirlineActive').mockRejectedValueOnce(
        boom(),
      );
      const failed = await admin.patch(
        `/admin/providers/airline/${airlineId}/deactivate`,
        {},
      );
      const airline = await s.col('airlines').findOne({ _id: oid(airlineId) });
      await settle(300);
      const notes = await s
        .col('notifications')
        .countDocuments({ type: 'provider_deactivated' });
      check(
        'fails cleanly; still active; nobody notified',
        [failed.status, airline?.isActive, notes - notesBefore],
        failed.status >= 500 &&
          isErrorShape(failed.body) &&
          airline?.isActive === true &&
          notes === notesBefore,
      );
      const again = await admin.patch(
        `/admin/providers/airline/${airlineId}/deactivate`,
        {},
      );
      check('succeeds afterwards', again.status, again.status < 300);
      await admin.patch(`/admin/providers/airline/${airlineId}/reactivate`, {});
    });
  });

  it('F9 account deactivation: deleting the sessions fails after the status change', async () => {
    await probe('F9 account deactivation', async (check) => {
      const user = await s.newUser('f9');
      vi.spyOn(
        s.t.connection.models.Session,
        'deleteMany',
      ).mockRejectedValueOnce(boom());
      const failed = await user
        .req('delete', '/users/me')
        .send({ confirm: true });
      const doc = await s.col('users').findOne({ _id: oid(user.id) });
      check(
        'fails cleanly or completes; never half-deactivated',
        [failed.status, doc?.status],
        (failed.status >= 500 &&
          isErrorShape(failed.body) &&
          doc?.status === 'active') ||
          (failed.status < 300 && doc?.status === 'deactivated'),
      );
      vi.restoreAllMocks();
      if (doc?.status === 'active') {
        const again = await user
          .req('delete', '/users/me')
          .send({ confirm: true });
        check('succeeds afterwards', again.status, again.status < 300);
      }
    });
  });

  it('keeps serving and records no unhandled rejection', async () => {
    expect((await s.guest().get('/health')).status).toBe(200);
    expect(s.unhandled).toEqual([]);
  });
});
