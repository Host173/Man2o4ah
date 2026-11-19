import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
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
