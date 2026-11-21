/**
 * S-09 · MEDIUM · integrity
 *
 * Rule broken: ACC-12 "their comments and reviews are shown as 'Deleted user'"
 * (and HTL-24, which lists a hotel's reviews).
 *
 * What breaks: GET /api/hotels/:id/reviews returns `{ _id, rating, text,
 * isHidden, createdAt }` with no author at all, so a deactivated author can
 * never show as "Deleted user" (the blog comments already do).
 *
 * Cause: src/modules/hotel-bookings/hotel-reviews.service.ts (`toView`, used by
 * `listForHotel`) and dto/hotel-review.response.dto.ts carry no author name.
 *
 * Suggested fix: resolve the authors with `AccountsService.getProfiles` (one
 * batched call) and return `authorName` on each review.
 */
import { Types } from 'mongoose';
import { confirmedHotelBooking, createRoom } from '../support/flows.js';
import { createStressApp, dateIn, type Stress } from '../support/stress-app.js';

const DAY_MS = 86_400_000;

describe('S-09 the review author after deactivation (ACC-12)', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(() => s?.close());

  it('lists "Deleted user" as the author of a deactivated user\'s review', async () => {
    const hotel = s.world.hotels['Thames Court'];
    const roomId = await createRoom(await s.as(hotel.moderator), hotel.id);
    const user = await s.newUser('s09');
    const booking = await confirmedHotelBooking(
      s,
      user,
      hotel.id,
      roomId,
      dateIn(40),
      dateIn(42),
    );
    const now = new Date();
    const midnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    await s.col('hotel_reservations').updateOne(
      { _id: new Types.ObjectId(booking.bookingId) },
      {
        $set: {
          checkInDate: new Date(midnight - 3 * DAY_MS),
          checkOutDate: new Date(midnight - 2 * DAY_MS),
        },
      },
    );
    await s.jobs.hotelCompletion();
    const review = await user.post(
      `/hotel-bookings/${booking.bookingId}/review`,
      { rating: 4, text: 'ok' },
    );
    expect(review.status, JSON.stringify(review.body)).toBe(201);
    await user.del('/users/me').send({ confirm: true });

    const list = await s.guest().get(`/hotels/${hotel.id}/reviews`);
    const item = (list.body?.items ?? []).find(
      (r: { _id: string }) => r._id === review.body._id,
    );
    expect(
      item?.authorName,
      'ACC-12: a deactivated author shows as "Deleted user"',
    ).toBe('Deleted user');
  });
});
