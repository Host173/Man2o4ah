import { BOOKING_GROUPS, groupQuery } from './booking-groups.js';

const NOW = new Date('2027-03-10T08:00:00Z');

describe('groupQuery (FLT-25)', () => {
  it('lists the three groups the page shows', () => {
    expect(BOOKING_GROUPS).toEqual(['upcoming', 'past', 'cancelled']);
  });

  it('upcoming: confirmed and not departed yet, soonest first', () => {
    expect(groupQuery('upcoming', NOW)).toEqual({
      filter: { status: 'confirmed', firstDepartureAt: { $gt: NOW } },
      sort: { firstDepartureAt: 1, _id: 1 },
    });
  });

  it('past: completed, or confirmed whose first flight has left, most recent first', () => {
    expect(groupQuery('past', NOW)).toEqual({
      filter: {
        $or: [
          { status: 'completed' },
          { status: 'confirmed', firstDepartureAt: { $lte: NOW } },
        ],
      },
      sort: { firstDepartureAt: -1, _id: -1 },
    });
  });

  it('cancelled: cancelled only, most recent departure first', () => {
    expect(groupQuery('cancelled', NOW)).toEqual({
      filter: { status: 'cancelled' },
      sort: { firstDepartureAt: -1, _id: -1 },
    });
  });
});
