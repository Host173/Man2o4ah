import { Types } from 'mongoose';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { AdminModule } from '../admin/admin.module.js';

/**
 * The admin booking route (owned by `admin`, ACC-17) with the real booking
 * services wired in: role gates and the sanitized, read-only response shape.
 */
describe('GET /api/admin/bookings with real booking services (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [AdminModule] });
  }, HOOK_TIMEOUT);
  beforeEach(() => clearCollections(t.connection));
  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function seedOneBookingOfEachType(): Promise<void> {
    await t.connection.collection('flight_bookings').insertOne({
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      status: 'confirmed',
      reference: 'FBZZZ999',
      tripType: 'one_way',
      segments: [
        {
          airlineId: new Types.ObjectId(),
          cabinClass: 'economy',
          policy: { extraBagPriceMinor: 999, cancellationTiers: [] },
        },
      ],
      passengers: [{ documentNumber: 'TOPSECRET-DOC', fullName: 'Probe User' }],
      pricing: { totalMinor: 100, currency: 'USD' },
      firstDepartureAt: new Date('2027-01-01T00:00:00.000Z'),
      lastDepartureAt: new Date('2027-01-01T01:00:00.000Z'),
      createdAt: new Date('2026-11-19T00:00:00.000Z'),
      holdExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
    });
    await t.connection.collection('hotel_reservations').insertOne({
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      hotelId: new Types.ObjectId(),
      status: 'confirmed',
      reference: 'HRZZZ999',
      checkInDate: new Date('2027-02-01T00:00:00.000Z'),
      checkOutDate: new Date('2027-02-04T00:00:00.000Z'),
      totalMinor: 24_000,
      currency: 'USD',
      rooms: [{ roomName: 'Deluxe', pricePerNightMinor: 8_000 }],
      policySnapshot: { cancellationTiers: [], checkInTime: '14:00' },
      createdAt: new Date('2026-11-18T00:00:00.000Z'),
      holdExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
    });
  }

  it('rejects unauthenticated requests (401)', async () => {
    const res = await t.http().get('/api/admin/bookings');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
  });

  it('rejects a non-admin user (403)', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const res = await t
      .http()
      .get('/api/admin/bookings')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.ForbiddenRole);
  });

  it('returns a paginated, sanitized list of both booking types to an admin', async () => {
    await seedOneBookingOfEachType();
    const admin = await loginAs(t.connection, UserRole.ADMIN);
    const res = await t
      .http()
      .get('/api/admin/bookings')
      .set('Cookie', admin.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    expect(res.body.items).toHaveLength(2);
    expect(
      res.body.items
        .map((row: { bookingType: string }) => row.bookingType)
        .sort(),
    ).toEqual(['flight', 'hotel']);
    expect(
      res.body.items.find(
        (row: { bookingType: string }) => row.bookingType === 'flight',
      ),
    ).toMatchObject({
      reference: 'FBZZZ999',
      totalMinor: 100,
      currency: 'USD',
    });

    // No document numbers, cabin policies or other internal fields are echoed back.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('TOPSECRET-DOC');
    expect(body).not.toContain('extraBagPriceMinor');
    expect(body).not.toContain('passwordHash');
  });

  it('filters by type, status and inclusive date range over the real services', async () => {
    await seedOneBookingOfEachType();
    const admin = await loginAs(t.connection, UserRole.ADMIN);

    const byType = await t
      .http()
      .get('/api/admin/bookings?type=hotel')
      .set('Cookie', admin.cookie);
    expect(byType.status).toBe(200);
    expect(byType.body.total).toBe(1);
    expect(byType.body.items[0].bookingType).toBe('hotel');

    const byStatus = await t
      .http()
      .get('/api/admin/bookings?status=cancelled')
      .set('Cookie', admin.cookie);
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.items).toEqual([]);
    expect(byStatus.body.total).toBe(0);

    const inRange = await t
      .http()
      .get('/api/admin/bookings?from=2026-11-18&to=2026-11-18')
      .set('Cookie', admin.cookie);
    expect(inRange.status).toBe(200);
    expect(inRange.body.total).toBe(1);

    const outOfRange = await t
      .http()
      .get('/api/admin/bookings?from=2026-11-17&to=2026-11-17')
      .set('Cookie', admin.cookie);
    expect(outOfRange.status).toBe(200);
    expect(outOfRange.body.items).toEqual([]);
  });
});
