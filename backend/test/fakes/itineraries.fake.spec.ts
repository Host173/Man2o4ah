import type { PublicItinerarySummary } from '../../src/modules/itineraries/itineraries.types.js';
import { FakeItinerariesService } from './itineraries.fake.js';

function itinerary(
  id: string,
  updatedAt: string,
  overrides: Partial<PublicItinerarySummary> = {},
): PublicItinerarySummary {
  return {
    id,
    ownerId: 'user-1',
    title: `Trip ${id}`,
    countryCodes: ['EG'],
    startDate: new Date('2026-12-01T00:00:00.000Z'),
    dayCount: 3,
    cityIds: ['cairo'],
    updatedAt: new Date(updatedAt),
    ...overrides,
  };
}

const seed = [
  itinerary('i-1', '2026-11-01T10:00:00.000Z'),
  itinerary('i-2', '2026-11-03T10:00:00.000Z', { ownerId: 'user-2' }),
  itinerary('i-3', '2026-11-02T10:00:00.000Z'),
];

const ids = (items: PublicItinerarySummary[]) => items.map((item) => item.id);

describe('FakeItinerariesService.listPublicByAuthor', () => {
  it('returns an empty page when nothing is seeded', async () => {
    const itineraries = new FakeItinerariesService();
    await expect(itineraries.listPublicByAuthor('user-1')).resolves.toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('lists one author, newest updatedAt first', async () => {
    const itineraries = new FakeItinerariesService(seed);
    const page = await itineraries.listPublicByAuthor('user-1');
    expect(ids(page.items)).toEqual(['i-3', 'i-1']);
    expect(page.total).toBe(2);
  });

  it('returns an empty page for an author who has none', async () => {
    const itineraries = new FakeItinerariesService(seed);
    const page = await itineraries.listPublicByAuthor('user-3');
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('paginates and keeps the total', async () => {
    const itineraries = new FakeItinerariesService(seed);
    const second = await itineraries.listPublicByAuthor('user-1', {
      page: 2,
      limit: 1,
    });
    expect(ids(second.items)).toEqual(['i-1']);
    expect(second).toMatchObject({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('returns no items past the last page', async () => {
    const itineraries = new FakeItinerariesService(seed);
    const page = await itineraries.listPublicByAuthor('user-1', {
      page: 3,
      limit: 1,
    });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(2);
  });

  it('defaults to page 1 and limit 10', async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      itinerary(
        `i-${index + 1}`,
        `2026-11-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      ),
    );
    const itineraries = new FakeItinerariesService(many);
    const page = await itineraries.listPublicByAuthor('user-1');
    expect(page.items).toHaveLength(10);
    expect(page).toMatchObject({
      page: 1,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
  });

  it('copies its data, so callers and fixtures cannot change each other', async () => {
    const fixtures = [itinerary('i-1', '2026-11-01T10:00:00.000Z')];
    const itineraries = new FakeItinerariesService(fixtures);
    fixtures[0].title = 'Changed';
    const first = await itineraries.listPublicByAuthor('user-1');
    first.items[0].title = 'Changed again';
    const second = await itineraries.listPublicByAuthor('user-1');
    expect(second.items[0].title).toBe('Trip i-1');
  });
});
