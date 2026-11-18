import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type { CreateItineraryDto } from '../../src/modules/itineraries/dto/create-itinerary.dto.js';
import type { PublicItinerarySummary } from '../../src/modules/itineraries/itineraries.types.js';
import { ItineraryVisibility } from '../../src/modules/itineraries/schemas/itinerary.schema.js';
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

function createDto(
  overrides: Partial<CreateItineraryDto> = {},
): CreateItineraryDto {
  return {
    title: '  Egypt in a week  ',
    countryCodes: ['EG'],
    startDate: '2027-04-01',
    ...overrides,
  };
}

describe('FakeItinerariesService owner-only methods', () => {
  it('creates a private itinerary and lists it for its owner only', async () => {
    const itineraries = new FakeItinerariesService();

    const created = await itineraries.create(createDto(), 'user-1');
    expect(created).toMatchObject({
      ownerId: 'user-1',
      title: 'Egypt in a week',
      countryCodes: ['EG'],
      startDate: '2027-04-01',
      dayCount: 0,
      visibility: ItineraryVisibility.PRIVATE,
      days: [],
      transportCosts: [],
    });

    const mine = await itineraries.listMine('user-1');
    expect(mine.items.map((item) => item._id)).toEqual([created._id]);

    const other = await itineraries.listMine('user-2');
    expect(other).toMatchObject({ items: [], total: 0 });
  });

  it('lists newest updatedAt first and paginates', async () => {
    const itineraries = new FakeItinerariesService();
    const first = await itineraries.create(
      createDto({ title: 'First' }),
      'user-1',
    );
    const second = await itineraries.create(
      createDto({ title: 'Second' }),
      'user-1',
    );

    const page = await itineraries.listMine('user-1', {
      page: 1,
      limit: 1,
    });
    expect(page.items.map((item) => item._id)).toEqual([second._id]);
    expect(page).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });

    const pageTwo = await itineraries.listMine('user-1', {
      page: 2,
      limit: 1,
    });
    expect(pageTwo.items.map((item) => item._id)).toEqual([first._id]);
  });

  it('opens, edits and deletes only its owner’s itinerary', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');

    await expect(
      itineraries.getById(created._id, 'user-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      itineraries.update(created._id, { title: 'Mine' }, 'user-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      itineraries.delete(created._id, 'user-2'),
    ).rejects.toBeInstanceOf(NotFoundException);

    const updated = await itineraries.update(
      created._id,
      { title: '  New title  ', countryCodes: ['EG', 'AE'] },
      'user-1',
    );
    expect(updated).toMatchObject({
      title: 'New title',
      countryCodes: ['EG', 'AE'],
      startDate: '2027-04-01',
    });

    await expect(
      itineraries.getById(created._id, 'user-1'),
    ).resolves.toBeDefined();
    await itineraries.delete(created._id, 'user-1');
    await expect(
      itineraries.getById(created._id, 'user-1'),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
  });

  it('leaves updatedAt alone when an update changes nothing', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');

    const unchanged = await itineraries.update(created._id, {}, 'user-1');
    expect(unchanged.updatedAt).toEqual(created.updatedAt);
  });

  it('adds days numbered and dated from the start date, and groups them by city', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');

    const first = await itineraries.addDay(
      created._id,
      { cityId: 'cairo', notes: 'Arrival' },
      'user-1',
    );
    expect(first).toMatchObject({
      dayNumber: 1,
      date: '2027-04-01',
      cityId: 'cairo',
      notes: 'Arrival',
      activities: [],
      budgetEntries: [],
    });

    await itineraries.addDay(created._id, { cityId: 'dubai' }, 'user-1');

    const detail = await itineraries.getById(created._id, 'user-1');
    expect(detail.days.map((day) => day.date)).toEqual([
      '2027-04-01',
      '2027-04-02',
    ]);
    expect(detail.cityGroups).toEqual([
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 1,
        dayCount: 1,
        checkIn: '2027-04-01',
        checkOut: '2027-04-02',
      },
      {
        cityId: 'dubai',
        fromDay: 2,
        toDay: 2,
        dayCount: 1,
        checkIn: '2027-04-02',
        checkOut: '2027-04-03',
      },
    ]);
  });

  it('edits a day and scopes days to their owner', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');
    const day = await itineraries.addDay(
      created._id,
      { cityId: 'cairo' },
      'user-1',
    );

    const updated = await itineraries.updateDay(
      created._id,
      day._id,
      { cityId: 'dubai', notes: 'Moved' },
      'user-1',
    );
    expect(updated).toMatchObject({ cityId: 'dubai', notes: 'Moved' });

    await expect(
      itineraries.updateDay(
        created._id,
        day._id,
        { cityId: 'cairo' },
        'user-2',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      itineraries.addDay(created._id, { cityId: 'cairo' }, 'user-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
