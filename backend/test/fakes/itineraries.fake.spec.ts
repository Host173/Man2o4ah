import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type { CreateItineraryDto } from '../../src/modules/itineraries/dto/create-itinerary.dto.js';
import type { PublicItinerarySummary } from '../../src/modules/itineraries/itineraries.types.js';
import { ItineraryVisibility } from '../../src/modules/itineraries/schemas/itinerary.schema.js';
import {
  FakeItinerariesService,
  type FakePublicItinerarySeed,
} from './itineraries.fake.js';

function itinerary(
  id: string,
  updatedAt: string,
  overrides: Partial<FakePublicItinerarySeed> = {},
): FakePublicItinerarySeed {
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

  it('leaves out private, hidden and deactivated-author itineraries (ITN-20)', async () => {
    const itineraries = new FakeItinerariesService([
      itinerary('public', '2026-11-05T10:00:00.000Z'),
      itinerary('private', '2026-11-04T10:00:00.000Z', {
        visibility: ItineraryVisibility.PRIVATE,
      }),
      itinerary('hidden', '2026-11-03T10:00:00.000Z', { isHidden: true }),
      itinerary('deactivated', '2026-11-02T10:00:00.000Z', {
        authorDeactivated: true,
      }),
    ]);

    const page = await itineraries.listPublicByAuthor('user-1');
    expect(ids(page.items)).toEqual(['public']);
    expect(page.total).toBe(1);
  });

  it('lists an owner-created itinerary only while it is public', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');
    expect((await itineraries.listPublicByAuthor('user-1')).items).toHaveLength(
      0,
    );

    await itineraries.update(
      created._id,
      { visibility: ItineraryVisibility.PUBLIC },
      'user-1',
    );
    const publicPage = await itineraries.listPublicByAuthor('user-1');
    expect(publicPage.items.map((item) => item.id)).toEqual([created._id]);
    expect(publicPage.items[0]).toMatchObject({
      title: 'Egypt in a week',
      startDate: new Date('2027-04-01T00:00:00.000Z'),
      cityIds: [],
    });

    await itineraries.update(
      created._id,
      { visibility: ItineraryVisibility.PRIVATE },
      'user-1',
    );
    expect((await itineraries.listPublicByAuthor('user-1')).items).toHaveLength(
      0,
    );
  });

  it('rejects invalid page and limit values with the real 400 shape', async () => {
    const itineraries = new FakeItinerariesService(seed);
    for (const [query, field] of [
      [{ page: 0 }, 'page'],
      [{ limit: 0 }, 'limit'],
      [{ limit: 51 }, 'limit'],
      [{ page: 1.5 }, 'page'],
    ] as const) {
      const error = await itineraries
        .listPublicByAuthor('user-1', query)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        details: { field: string }[];
      };
      expect(response.code).toBe(ErrorCode.ValidationFailed);
      expect(response.details[0].field).toBe(field);
    }
  });

  it('hides and restores an author’s itineraries on deactivation events (ACC-12)', async () => {
    const ownerId = 'a'.repeat(24);
    const otherId = 'b'.repeat(24);
    const itineraries = new FakeItinerariesService([
      itinerary('i-1', '2026-11-01T10:00:00.000Z', { ownerId }),
      itinerary('i-2', '2026-11-02T10:00:00.000Z', { ownerId: otherId }),
    ]);
    const created = await itineraries.create(createDto(), ownerId);
    await itineraries.update(
      created._id,
      { visibility: ItineraryVisibility.PUBLIC },
      ownerId,
    );

    await itineraries.onUserDeactivated({ userId: ownerId });
    expect((await itineraries.listPublicByAuthor(ownerId)).items).toHaveLength(
      0,
    );
    expect(
      (await itineraries.getById(created._id, ownerId)).authorDeactivated,
    ).toBe(true);
    expect((await itineraries.listPublicByAuthor(otherId)).items).toHaveLength(
      1,
    );

    // A malformed ID is a no-op, like the real service's handler.
    await itineraries.onUserDeactivated({ userId: 'bad-id' });
    expect((await itineraries.listPublicByAuthor(otherId)).items).toHaveLength(
      1,
    );

    await itineraries.onUserReactivated({ userId: ownerId });
    expect((await itineraries.listPublicByAuthor(ownerId)).items).toHaveLength(
      2,
    );
    expect(
      (await itineraries.getById(created._id, ownerId)).authorDeactivated,
    ).toBe(false);
  });

  it('searchPublic lists only public, visible items from every author', async () => {
    const itineraries = new FakeItinerariesService([
      itinerary('visible', '2026-11-05T10:00:00.000Z'),
      itinerary('other', '2026-11-04T10:00:00.000Z', { ownerId: 'user-2' }),
      itinerary('private', '2026-11-03T10:00:00.000Z', {
        visibility: ItineraryVisibility.PRIVATE,
      }),
      itinerary('hidden', '2026-11-02T10:00:00.000Z', { isHidden: true }),
      itinerary('deactivated', '2026-11-01T10:00:00.000Z', {
        authorDeactivated: true,
      }),
    ]);
    const created = await itineraries.create(createDto(), 'user-3');
    await itineraries.update(
      created._id,
      { visibility: ItineraryVisibility.PUBLIC },
      'user-3',
    );

    const page = await itineraries.searchPublic();
    expect(page.items).toHaveLength(3);
    expect(ids(page.items)).toEqual(
      expect.arrayContaining(['visible', 'other', created._id]),
    );
    expect(page.total).toBe(3);

    await itineraries.update(
      created._id,
      { visibility: ItineraryVisibility.PRIVATE },
      'user-3',
    );
    expect(ids((await itineraries.searchPublic()).items)).toEqual([
      'visible',
      'other',
    ]);
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
  it('preserves optional fields and zero cost through activity edits and removal', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');
    const day = await itineraries.addDay(
      created._id,
      { cityId: 'cairo' },
      'user-1',
    );
    const added = await itineraries.addActivity(
      created._id,
      day._id,
      {
        name: 'Museum',
        description: 'Keep',
        time: '23:59',
        cost: { amountMinor: 100, currency: 'JPY' },
      },
      'user-1',
    );
    const id = added.activities[0]._id;
    const edited = await itineraries.updateActivity(
      id,
      { cost: { amountMinor: 0, currency: 'USD' } },
      'user-1',
    );
    expect(edited).toMatchObject({
      name: 'Museum',
      description: 'Keep',
      time: '23:59',
      cost: { amountMinor: 0, currency: 'USD' },
    });
    expect(await itineraries.updateActivity(id, {}, 'user-1')).toEqual(edited);
    await expect(
      itineraries.updateActivity(id, { name: 'Foreign' }, 'user-2'),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      itineraries.deleteActivity(id, 'user-2'),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await itineraries.deleteActivity(id, 'user-1');
    expect(
      (await itineraries.getById(created._id, 'user-1')).days[0].activities,
    ).toEqual([]);
    await expect(
      itineraries.deleteActivity(id, 'user-1'),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
  });

  it('rejects invalid activity input and missing resources without mutation', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');
    const day = await itineraries.addDay(
      created._id,
      { cityId: 'cairo' },
      'user-1',
    );
    const added = await itineraries.addActivity(
      created._id,
      day._id,
      { name: 'Keep' },
      'user-1',
    );
    const id = added.activities[0]._id;
    await expect(
      itineraries.updateActivity(
        id,
        { cost: { amountMinor: 1, currency: 'ZZZ' } },
        'user-1',
      ),
    ).rejects.toMatchObject({
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'cost.currency' }],
      },
    });
    await expect(
      itineraries.updateActivity('bad', {}, 'user-1'),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await expect(
      itineraries.deleteActivity('bad', 'user-1'),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await expect(
      itineraries.addActivity(created._id, 'bad', { name: 'New' }, 'user-1'),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await expect(
      itineraries.addActivity(
        created._id,
        'f'.repeat(24),
        { name: 'New' },
        'user-1',
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      itineraries.updateActivity('f'.repeat(24), {}, 'user-1'),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    expect(
      (await itineraries.getById(created._id, 'user-1')).days[0].activities,
    ).toEqual(added.activities);
  });

  it('adds an owned activity instead of throwing an unimplemented stub', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');
    const day = await itineraries.addDay(
      created._id,
      { cityId: 'cairo' },
      'user-1',
    );
    const updated = await itineraries.addActivity(
      created._id,
      day._id,
      { name: '  Museum  ' },
      'user-1',
    );
    expect(updated.activities).toEqual([
      { _id: expect.any(String), name: 'Museum', images: [] },
    ]);
    updated.activities[0].name = 'Changed outside the fake';
    const stored = await itineraries.getById(created._id, 'user-1');
    expect(stored.days[0].activities[0].name).toBe('Museum');
    await expect(
      itineraries.addActivity(
        created._id,
        day._id,
        { name: 'Foreign' },
        'user-2',
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
  });

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

  it('sets visibility and rejects anything else with the real 400 shape (ITN-20)', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');

    const updated = await itineraries.update(
      created._id,
      { visibility: ItineraryVisibility.PUBLIC },
      'user-1',
    );
    expect(updated.visibility).toBe(ItineraryVisibility.PUBLIC);

    for (const visibility of ['hidden', null, '', 1]) {
      const error = await itineraries
        .update(created._id, { visibility } as never, 'user-1')
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(response.code).toBe(ErrorCode.ValidationFailed);
      expect(response.message).toBe('Validation failed');
      expect(response.details).toEqual([
        {
          field: 'visibility',
          message: 'visibility must be public or private',
        },
      ]);
    }

    // A rejected value never changes the stored visibility.
    const detail = await itineraries.getById(created._id, 'user-1');
    expect(detail.visibility).toBe(ItineraryVisibility.PUBLIC);
  });

  it('leaves updatedAt alone when an update changes nothing', async () => {
    vi.useFakeTimers({ now: new Date('2027-01-01T00:00:00.000Z') });
    try {
      const itineraries = new FakeItinerariesService();
      const created = await itineraries.create(createDto(), 'user-1');

      // Move the clock on, so a bump would show up as a different updatedAt.
      vi.setSystemTime(new Date('2027-01-02T00:00:00.000Z'));
      const unchanged = await itineraries.update(created._id, {}, 'user-1');
      expect(unchanged.updatedAt).toEqual(created.updatedAt);
    } finally {
      vi.useRealTimers();
    }
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

  it('deletes a day and renumbers, re-dates and regroups the rest', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');
    const first = await itineraries.addDay(
      created._id,
      { cityId: 'cairo', notes: 'Arrival' },
      'user-1',
    );
    const middle = await itineraries.addDay(
      created._id,
      { cityId: 'dubai' },
      'user-1',
    );
    const last = await itineraries.addDay(
      created._id,
      { cityId: 'cairo' },
      'user-1',
    );

    await itineraries.deleteDay(created._id, middle._id, 'user-1');

    const detail = await itineraries.getById(created._id, 'user-1');
    expect(detail.days.map((day) => day._id)).toEqual([first._id, last._id]);
    expect(detail.days.map((day) => day.dayNumber)).toEqual([1, 2]);
    expect(detail.days.map((day) => day.date)).toEqual([
      '2027-04-01',
      '2027-04-02',
    ]);
    expect(detail.days[0].notes).toBe('Arrival');
    expect(detail.dayCount).toBe(2);
    expect(detail.cityGroups).toEqual([
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 2,
        dayCount: 2,
        checkIn: '2027-04-01',
        checkOut: '2027-04-03',
      },
    ]);

    await expect(
      itineraries.deleteDay(created._id, first._id, 'user-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      itineraries.deleteDay('missing', first._id, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reorders days and recalculates numbers, dates and city groups', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto(), 'user-1');
    const first = await itineraries.addDay(
      created._id,
      { cityId: 'cairo', notes: 'Arrival' },
      'user-1',
    );
    const middle = await itineraries.addDay(
      created._id,
      { cityId: 'dubai' },
      'user-1',
    );
    const last = await itineraries.addDay(
      created._id,
      { cityId: 'cairo' },
      'user-1',
    );
    const order = [last._id, first._id, middle._id];

    const reordered = await itineraries.reorderDays(
      created._id,
      { dayIds: order },
      'user-1',
    );

    expect(reordered.days.map((day) => day._id)).toEqual(order);
    expect(reordered.days.map((day) => day.dayNumber)).toEqual([1, 2, 3]);
    expect(reordered.days.map((day) => day.date)).toEqual([
      '2027-04-01',
      '2027-04-02',
      '2027-04-03',
    ]);
    expect(reordered.days.map((day) => day.cityId)).toEqual([
      'cairo',
      'cairo',
      'dubai',
    ]);
    expect(reordered.days[1].notes).toBe('Arrival');
    expect(reordered.cityGroups).toEqual([
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 2,
        dayCount: 2,
        checkIn: '2027-04-01',
        checkOut: '2027-04-03',
      },
      {
        cityId: 'dubai',
        fromDay: 3,
        toDay: 3,
        dayCount: 1,
        checkIn: '2027-04-03',
        checkOut: '2027-04-04',
      },
    ]);

    const unchanged = await itineraries.reorderDays(
      created._id,
      { dayIds: order },
      'user-1',
    );
    expect(unchanged.updatedAt.getTime()).toBe(reordered.updatedAt.getTime());

    await expect(
      itineraries.reorderDays(created._id, { dayIds: order }, 'user-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a reorder that is not a permutation of the current days', async () => {
    const itineraries = new FakeItinerariesService();
    const created = await itineraries.create(createDto() as never, 'user-1');
    const first = await itineraries.addDay(
      created._id,
      { cityId: 'cairo' },
      'user-1',
    );
    await itineraries.addDay(created._id, { cityId: 'dubai' }, 'user-1');
    const unknown = 'ffffffffffffffffffffffff';

    for (const dayIds of [
      undefined,
      [first._id],
      [first._id, first._id],
      [first._id, unknown],
      [first._id, null as unknown as string],
    ]) {
      const error = await itineraries
        .reorderDays(created._id, { dayIds } as never, 'user-1')
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        details: { field: string }[];
      };
      expect(response.code).toBe(ErrorCode.ValidationFailed);
      expect(response.details[0].field).toBe('dayIds');
    }

    // No rejected input may reorder, drop or duplicate days.
    const detail = await itineraries.getById(created._id, 'user-1');
    expect(detail.days.map((day) => day._id)).toHaveLength(2);
    expect(new Set(detail.days.map((day) => day._id)).size).toBe(2);
  });

  describe('day validation parity (ITN-05)', () => {
    it('rejects the 61st day with the same validation error as the real service', async () => {
      const itineraries = new FakeItinerariesService();
      const created = await itineraries.create(createDto(), 'user-1');

      // Fill up to the 60-day cap.
      for (let i = 0; i < 60; i++) {
        await itineraries.addDay(
          created._id,
          { cityId: 'cairo', notes: `Day ${i + 1}` },
          'user-1',
        );
      }

      const error = await itineraries
        .addDay(created._id, { cityId: 'dubai' }, 'user-1')
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(response.code).toBe(ErrorCode.ValidationFailed);
      expect(response.message).toBe('Validation failed');
      expect(response.details).toEqual([
        { field: 'days', message: 'an itinerary has at most 60 days' },
      ]);
    });

    it('rejects an unknown city on add and edit with the same error shape', async () => {
      const itineraries = new FakeItinerariesService();
      const created = await itineraries.create(createDto(), 'user-1');

      const addError = await itineraries
        .addDay(created._id, { cityId: 'atlantis' }, 'user-1')
        .catch((caught: unknown) => caught);
      expect(addError).toBeInstanceOf(BadRequestException);
      const addResponse = (addError as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(addResponse.code).toBe(ErrorCode.ValidationFailed);
      expect(addResponse.message).toBe('Validation failed');
      expect(addResponse.details[0].field).toBe('cityId');
      expect(addResponse.details[0].message).toBe('Unknown city: atlantis');

      const day = await itineraries.addDay(
        created._id,
        { cityId: 'cairo' },
        'user-1',
      );
      const editError = await itineraries
        .updateDay(created._id, day._id, { cityId: 'nowhere' }, 'user-1')
        .catch((caught: unknown) => caught);
      expect(editError).toBeInstanceOf(BadRequestException);
      const editResponse = (editError as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(editResponse.code).toBe(ErrorCode.ValidationFailed);
      expect(editResponse.message).toBe('Validation failed');
      expect(editResponse.details[0].field).toBe('cityId');
      expect(editResponse.details[0].message).toBe('Unknown city: nowhere');
    });

    it('rejects notes longer than MAX_NOTES_LENGTH with the same error shape', async () => {
      const itineraries = new FakeItinerariesService();
      const created = await itineraries.create(createDto(), 'user-1');

      const error = await itineraries
        .addDay(
          created._id,
          { cityId: 'cairo', notes: 'n'.repeat(2001) },
          'user-1',
        )
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(response.code).toBe(ErrorCode.ValidationFailed);
      expect(response.details[0].field).toBe('notes');
      expect(response.message).toBe('Validation failed');
    });
    it('returns the day untouched and does not bump updatedAt for an empty patch', async () => {
      vi.useFakeTimers({ now: new Date('2027-01-01T00:00:00.000Z') });
      try {
        const itineraries = new FakeItinerariesService();
        const created = await itineraries.create(createDto(), 'user-1');
        const day = await itineraries.addDay(
          created._id,
          { cityId: 'cairo', notes: 'Arrival' },
          'user-1',
        );
        // Move the clock on, so a bump would show up as a different updatedAt.
        vi.setSystemTime(new Date('2027-01-02T00:00:00.000Z'));
        const before = await itineraries.getById(created._id, 'user-1');

        const untouched = await itineraries.updateDay(
          created._id,
          day._id,
          {},
          'user-1',
        );
        expect(untouched).toMatchObject({ cityId: 'cairo', notes: 'Arrival' });

        const after = await itineraries.getById(created._id, 'user-1');
        expect(after.updatedAt).toEqual(before.updatedAt);
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects a non-string notes value with 400 VALIDATION_FAILED', async () => {
      const itineraries = new FakeItinerariesService();
      const created = await itineraries.create(createDto(), 'user-1');

      const error = await itineraries
        .addDay(
          created._id,
          { cityId: 'cairo', notes: null as unknown as string },
          'user-1',
        )
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(response.code).toBe(ErrorCode.ValidationFailed);
      expect(response.details[0].field).toBe('notes');
    });

    it('rejects a non-string cityId on patch with 400 VALIDATION_FAILED', async () => {
      const itineraries = new FakeItinerariesService();
      const created = await itineraries.create(createDto(), 'user-1');
      const day = await itineraries.addDay(
        created._id,
        { cityId: 'cairo' },
        'user-1',
      );

      const error = await itineraries
        .updateDay(
          created._id,
          day._id,
          { cityId: null as unknown as string },
          'user-1',
        )
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(response.code).toBe(ErrorCode.ValidationFailed);
      expect(response.details[0].field).toBe('cityId');
      expect(response.details[0].message).toBe('cityId must be a string');
    });

    it('leaves the day unchanged when a patch fails validation (no partial mutation)', async () => {
      const itineraries = new FakeItinerariesService();
      const created = await itineraries.create(createDto(), 'user-1');
      const day = await itineraries.addDay(
        created._id,
        { cityId: 'cairo' },
        'user-1',
      );

      const error = await itineraries
        .updateDay(
          created._id,
          day._id,
          { cityId: 'dubai', notes: 'n'.repeat(2001) },
          'user-1',
        )
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(response.code).toBe(ErrorCode.ValidationFailed);
      expect(response.details[0].field).toBe('notes');

      const detail = await itineraries.getById(created._id, 'user-1');
      expect(detail.days).toHaveLength(1);
      expect(detail.days[0].cityId).toBe('cairo');
      expect(detail.days[0].notes).toBeUndefined();
    });

    it('checks the city before the day cap for a 61st day with an unknown city', async () => {
      const itineraries = new FakeItinerariesService();
      const created = await itineraries.create(createDto(), 'user-1');
      for (let i = 0; i < 60; i++) {
        await itineraries.addDay(created._id, { cityId: 'cairo' }, 'user-1');
      }

      const error = await itineraries
        .addDay(created._id, { cityId: 'atlantis' }, 'user-1')
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(response.details[0].field).toBe('cityId');
      expect(response.details[0].message).toBe('Unknown city: atlantis');
    });

    it('validates notes before the day cap for a 61st day', async () => {
      const itineraries = new FakeItinerariesService();
      const created = await itineraries.create(createDto(), 'user-1');
      for (let i = 0; i < 60; i++) {
        await itineraries.addDay(created._id, { cityId: 'cairo' }, 'user-1');
      }

      const error = await itineraries
        .addDay(
          created._id,
          { cityId: 'dubai', notes: 'n'.repeat(2001) },
          'user-1',
        )
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { field: string; message: string }[];
      };
      expect(response.details[0].field).toBe('notes');
    });
  });
});
