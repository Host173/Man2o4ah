import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelReservation } from './schemas/hotel-reservation.schema.js';

const URL = '/api/hotel-bookings';

describe('hotel cancellation endpoints (HTL-21)', () => {
  let t: TestApp;
  let reservations: Model<HotelReservation>;
  const payments = new FakePaymentsService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (b) =>
        b
          .overrideProvider(RoomNightInventory)
          .useValue(new FakeRoomNightInventory(new FakeHotelsService()))
          .overrideProvider(PaymentsService)
          .useValue(payments),
    });
    reservations = t.moduleRef.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
  }, HOOK_TIMEOUT);
  beforeEach(async () => {
    await clearCollections(t.connection);
    payments.refunds.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-07T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function seed(userId: string) {
    return reservations.create({
      userId,
      hotelId: new Types.ObjectId(),
      status: 'confirmed',
      reference: 'HRABCDEF',
      checkInDate: toDateOnly('2027-03-10'),
      checkOutDate: toDateOnly('2027-03-12'),
      nights: 2,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomName: '101',
          roomType: 'Double',
          pricePerNightMinor: 5000,
          adults: 1,
          childAges: [],
          subtotalMinor: 10_000,
        },
      ],
      totalMinor: 10_000,
      currency: 'USD',
      policySnapshot: {
        cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
        checkInTime: '15:00',
        checkOutTime: '11:00',
      },
      holdExpiresAt: new Date('2027-03-01T00:10:00Z'),
    });
  }

  it('previews then cancels the whole reservation with typed public responses', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const reservation = await seed(user.id);
    const preview = await t
      .http()
      .get(`${URL}/${reservation.id}/refund-preview`)
      .set('Cookie', user.cookie);
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      percent: 50,
      amountMinor: 5000,
      currency: 'USD',
    });
    const result = await t
      .http()
      .post(`${URL}/${reservation.id}/cancel`)
      .set('Cookie', user.cookie)
      .send({});
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual([
      '_id',
      'cancellation',
      'reference',
      'refund',
      'status',
    ]);
    expect(result.body).toMatchObject({
      _id: reservation.id,
      reference: 'HRABCDEF',
      status: 'cancelled',
      cancellation: {
        cancelledAt: '2027-03-07T00:00:00.000Z',
        cancelledBy: 'user',
        refundPercent: 50,
        refundAmountMinor: 5000,
      },
      refund: { status: 'pending', amountMinor: 5000, currency: 'USD' },
    });
    expect(result.body.refund.refundId).toMatch(/^[0-9a-f]{24}$/);
  });

  it.each(['refund-preview', 'cancel'])(
    '%s requires login, correct role and ownership',
    async (action) => {
      const user = await loginAs(t.connection, UserRole.USER);
      const reservation = await seed(user.id);
      const call = (id = reservation.id) =>
        action === 'cancel'
          ? t.http().post(`${URL}/${id}/${action}`).send({})
          : t.http().get(`${URL}/${id}/${action}`);
      expect((await call()).status).toBe(401);
      expect((await call()).body.code).toBe(ErrorCode.NotAuthenticated);
      for (const role of [
        UserRole.ADMIN,
        UserRole.HOTEL_MODERATOR,
        UserRole.AIRLINE_MODERATOR,
      ]) {
        const other = await loginAs(t.connection, role);
        const result = await call().set('Cookie', other.cookie);
        expect(result.status).toBe(403);
        expect(result.body.code).toBe(ErrorCode.ForbiddenRole);
      }
      const other = await loginAs(t.connection, UserRole.USER);
      const hidden = await call().set('Cookie', other.cookie);
      expect(hidden.status).toBe(404);
      expect(hidden.body.code).toBe(ErrorCode.NotFound);
      const missing = await call(new Types.ObjectId().toHexString()).set(
        'Cookie',
        user.cookie,
      );
      expect(missing.status).toBe(404);
      const malformed = await call('invalid').set('Cookie', user.cookie);
      expect(malformed.status).toBe(400);
      expect(malformed.body.code).toBe(ErrorCode.ValidationFailed);
    },
  );

  it('rejects partial cancellation and forged prices/owners', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const reservation = await seed(user.id);
    for (const body of [
      { rooms: [reservation.rooms[0].roomId.toString()] },
      { amountMinor: 1 },
      { userId: user.id },
    ]) {
      const result = await t
        .http()
        .post(`${URL}/${reservation.id}/cancel`)
        .set('Cookie', user.cookie)
        .send(body);
      expect(result.status).toBe(400);
      expect(result.body.code).toBe(ErrorCode.ValidationFailed);
      expect(result.body.details).toHaveLength(1);
    }
    expect((await reservations.findById(reservation.id).lean())?.status).toBe(
      'confirmed',
    );
  });

  it.each(['refund-preview', 'cancel'])(
    '%s blocks check-in day and already-cancelled reservations',
    async (action) => {
      const user = await loginAs(t.connection, UserRole.USER);
      const reservation = await seed(user.id);
      const call = () =>
        (action === 'cancel'
          ? t.http().post(`${URL}/${reservation.id}/cancel`).send({})
          : t.http().get(`${URL}/${reservation.id}/refund-preview`)
        ).set('Cookie', user.cookie);
      vi.setSystemTime(new Date('2027-03-10T00:00:00Z'));
      let result = await call();
      expect(result.status).toBe(409);
      expect(result.body.code).toBe(ErrorCode.InvalidStatusTransition);
      vi.setSystemTime(new Date('2027-03-07T00:00:00Z'));
      await reservations.updateOne(
        { _id: reservation.id },
        { $set: { status: 'cancelled' } },
      );
      result = await call();
      expect(result.status).toBe(409);
      expect(result.body.code).toBe(ErrorCode.InvalidStatusTransition);
    },
  );

  it('documents both operations, public response types and auth errors in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    for (const [route, method] of [
      ['refund-preview', 'get'],
      ['cancel', 'post'],
    ] as const) {
      const operation = document.paths[`${URL}/{id}/${route}`]?.[method];
      expect(operation?.summary).toMatch(/^HTL-21 /);
      expect(operation?.responses['200']).toMatchObject({
        content: {
          'application/json': { schema: { $ref: expect.any(String) } },
        },
      });
      for (const code of ['400', '401', '403', '404', '409']) {
        expect(operation?.responses[code]).toBeDefined();
      }
    }
  });
});
