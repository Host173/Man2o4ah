import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../../common/errors/validation-exception.factory.js';
import { normalizeTag, normalizeTags } from '../blog-tags.js';
import { PostStatus } from '../schemas/post.schema.js';
import { AuthorPageQueryDto } from './author-page-query.dto.js';
import { CreateCommentDto } from './create-comment.dto.js';
import { CreatePostDto } from './create-post.dto.js';
import { ListPostsQueryDto } from './list-posts-query.dto.js';
import {
  AuthorPageResponseDto,
  CommentResponseDto,
  PaginatedCommentsResponseDto,
  PaginatedPublicItinerariesResponseDto,
  PaginatedPublishedPostsResponseDto,
  PostDetailResponseDto,
  PublicItinerarySummaryResponseDto,
  PublishedPostResponseDto,
} from './post.response.dto.js';
import { UpdateCommentDto } from './update-comment.dto.js';
import { UpdatePostDto } from './update-post.dto.js';

function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });
}

async function expectValidationError(
  promise: Promise<unknown>,
  expectedField?: string,
): Promise<void> {
  try {
    await promise;
    expect.unreachable('Expected ValidationPipe to throw BadRequestException');
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    const response = (err as BadRequestException).getResponse() as {
      code: string;
      details: Array<{ field: string; message: string }>;
    };
    expect(response.code).toBe('VALIDATION_FAILED');
    if (expectedField !== undefined) {
      expect(
        response.details.some((detail) => detail.field === expectedField),
      ).toBe(true);
    }
  }
}

describe('CreatePostDto & UpdatePostDto', () => {
  const pipe = createValidationPipe();

  describe('CreatePostDto', () => {
    it('accepts valid draft and published payloads and trims title without trimming body', async () => {
      const draft = (await pipe.transform(
        {
          title: '  Cairo Weekend Notes  ',
          body: '  Walked along the Nile at sunset.  ',
          status: PostStatus.DRAFT,
        },
        { type: 'body', metatype: CreatePostDto },
      )) as CreatePostDto;

      expect(draft).toBeInstanceOf(CreatePostDto);
      expect(draft.title).toBe('Cairo Weekend Notes');
      expect(draft.body).toBe('  Walked along the Nile at sunset.  ');
      expect(draft.status).toBe('draft');

      const published = (await pipe.transform(
        {
          title: 'A',
          body: 'B',
          status: PostStatus.PUBLISHED,
        },
        { type: 'body', metatype: CreatePostDto },
      )) as CreatePostDto;

      expect(published.status).toBe('published');
    });

    it('accepts max boundary lengths for title (150) and body (20000)', async () => {
      const dto = (await pipe.transform(
        {
          title: 't'.repeat(150),
          body: 'b'.repeat(20_000),
          status: PostStatus.PUBLISHED,
        },
        { type: 'body', metatype: CreatePostDto },
      )) as CreatePostDto;

      expect(dto.title).toHaveLength(150);
      expect(dto.body).toHaveLength(20_000);
    });

    it('rejects missing required fields', async () => {
      await expectValidationError(
        pipe.transform({}, { type: 'body', metatype: CreatePostDto }),
        'title',
      );
      await expectValidationError(
        pipe.transform(
          { title: 'Title' },
          { type: 'body', metatype: CreatePostDto },
        ),
        'body',
      );
      await expectValidationError(
        pipe.transform(
          { title: 'Title', body: 'Body' },
          { type: 'body', metatype: CreatePostDto },
        ),
        'status',
      );
    });

    it('rejects empty, whitespace-only, over-length, and non-string title or body', async () => {
      await expectValidationError(
        pipe.transform(
          { title: '', body: 'Valid body', status: PostStatus.DRAFT },
          { type: 'body', metatype: CreatePostDto },
        ),
        'title',
      );
      await expectValidationError(
        pipe.transform(
          { title: '   ', body: 'Valid body', status: PostStatus.DRAFT },
          { type: 'body', metatype: CreatePostDto },
        ),
        'title',
      );
      await expectValidationError(
        pipe.transform(
          {
            title: 't'.repeat(151),
            body: 'Valid body',
            status: PostStatus.DRAFT,
          },
          { type: 'body', metatype: CreatePostDto },
        ),
        'title',
      );
      await expectValidationError(
        pipe.transform(
          { title: 123, body: 'Valid body', status: PostStatus.DRAFT },
          { type: 'body', metatype: CreatePostDto },
        ),
        'title',
      );
      await expectValidationError(
        pipe.transform(
          { title: 'Valid', body: '', status: PostStatus.DRAFT },
          { type: 'body', metatype: CreatePostDto },
        ),
        'body',
      );
      await expectValidationError(
        pipe.transform(
          { title: 'Valid', body: '    ', status: PostStatus.DRAFT },
          { type: 'body', metatype: CreatePostDto },
        ),
        'body',
      );
      await expectValidationError(
        pipe.transform(
          {
            title: 'Valid',
            body: 'b'.repeat(20_001),
            status: PostStatus.DRAFT,
          },
          { type: 'body', metatype: CreatePostDto },
        ),
        'body',
      );
    });

    it('rejects invalid post status', async () => {
      await expectValidationError(
        pipe.transform(
          { title: 'Valid', body: 'Valid body', status: 'archived' },
          { type: 'body', metatype: CreatePostDto },
        ),
        'status',
      );
    });

    it('forbids client-controlled and unknown fields', async () => {
      for (const extra of [
        { authorId: '507f1f77bcf86cd799439011' },
        { images: [{ key: 'blog/x.png' }] },
        { publishedAt: new Date().toISOString() },
        { likeCount: 99 },
        { commentCount: 12 },
        { isHidden: true },
        { authorDeactivated: true },
        { _id: '507f1f77bcf86cd799439011' },
      ]) {
        await expectValidationError(
          pipe.transform(
            {
              title: 'Valid',
              body: 'Valid body',
              status: PostStatus.DRAFT,
              ...extra,
            },
            { type: 'body', metatype: CreatePostDto },
          ),
        );
      }
    });
  });

  describe('UpdatePostDto', () => {
    it('allows partial updates and keeps omitted fields undefined', async () => {
      const empty = (await pipe.transform(
        {},
        { type: 'body', metatype: UpdatePostDto },
      )) as UpdatePostDto;
      expect(empty.title).toBeUndefined();
      expect(empty.body).toBeUndefined();
      expect(empty.status).toBeUndefined();
      expect(empty.tags).toBeUndefined();

      const partial = (await pipe.transform(
        { title: '  Updated Title  ' },
        { type: 'body', metatype: UpdatePostDto },
      )) as UpdatePostDto;
      expect(partial.title).toBe('Updated Title');
      expect(partial.body).toBeUndefined();
      expect(partial.status).toBeUndefined();
    });

    it('rejects null values on optional fields because skipNullProperties is false', async () => {
      await expectValidationError(
        pipe.transform(
          { title: null },
          { type: 'body', metatype: UpdatePostDto },
        ),
        'title',
      );
      await expectValidationError(
        pipe.transform(
          { body: null },
          { type: 'body', metatype: UpdatePostDto },
        ),
        'body',
      );
      await expectValidationError(
        pipe.transform(
          { status: null },
          { type: 'body', metatype: UpdatePostDto },
        ),
        'status',
      );
      await expectValidationError(
        pipe.transform(
          { tags: null },
          { type: 'body', metatype: UpdatePostDto },
        ),
        'tags',
      );
    });

    it('rejects invalid constraints and non-whitelisted fields on update', async () => {
      await expectValidationError(
        pipe.transform(
          { title: '   ' },
          { type: 'body', metatype: UpdatePostDto },
        ),
        'title',
      );
      await expectValidationError(
        pipe.transform(
          { body: '    ' },
          { type: 'body', metatype: UpdatePostDto },
        ),
        'body',
      );
      await expectValidationError(
        pipe.transform(
          { status: 'deleted' },
          { type: 'body', metatype: UpdatePostDto },
        ),
        'status',
      );
      await expectValidationError(
        pipe.transform(
          { title: 'Updated', likeCount: 10 },
          { type: 'body', metatype: UpdatePostDto },
        ),
      );
    });
  });

  describe('ListPostsQueryDto & BLG-02 response DTOs', () => {
    it('defaults pagination values and leaves tag undefined when omitted or blank', async () => {
      const defaults = (await pipe.transform(
        {},
        { type: 'query', metatype: ListPostsQueryDto },
      )) as ListPostsQueryDto;

      expect(defaults).toBeInstanceOf(ListPostsQueryDto);
      expect(defaults.page).toBe(1);
      expect(defaults.limit).toBe(10);
      expect(defaults.tag).toBeUndefined();

      const blankTag = (await pipe.transform(
        { tag: '   ' },
        { type: 'query', metatype: ListPostsQueryDto },
      )) as ListPostsQueryDto;
      expect(blankTag.tag).toBeUndefined();
    });

    it('normalises tag filter (trim and lowercase) alongside pagination params', async () => {
      const query = (await pipe.transform(
        { page: '2', limit: '5', tag: '  EGYPT-2026  ' },
        { type: 'query', metatype: ListPostsQueryDto },
      )) as ListPostsQueryDto;

      expect(query.page).toBe(2);
      expect(query.limit).toBe(5);
      expect(query.tag).toBe('egypt-2026');
    });

    it('rejects invalid page, limit, non-string tag, or unknown query params', async () => {
      await expectValidationError(
        pipe.transform(
          { page: '0' },
          { type: 'query', metatype: ListPostsQueryDto },
        ),
        'page',
      );
      await expectValidationError(
        pipe.transform(
          { limit: '51' },
          { type: 'query', metatype: ListPostsQueryDto },
        ),
        'limit',
      );
      await expectValidationError(
        pipe.transform(
          { tag: ['egypt', 'siwa'] },
          { type: 'query', metatype: ListPostsQueryDto },
        ),
        'tag',
      );
      await expectValidationError(
        pipe.transform(
          { q: 'cairo' },
          { type: 'query', metatype: ListPostsQueryDto },
        ),
      );
    });

    it('constructs Swagger response DTO classes cleanly', () => {
      const published = new PublishedPostResponseDto();
      const page = new PaginatedPublishedPostsResponseDto();
      const comment = new CommentResponseDto();
      const commentsPage = new PaginatedCommentsResponseDto();
      const detail = new PostDetailResponseDto();
      const itinerarySummary = new PublicItinerarySummaryResponseDto();
      const itineraryPage = new PaginatedPublicItinerariesResponseDto();
      const authorPage = new AuthorPageResponseDto();

      expect(published).toBeInstanceOf(PublishedPostResponseDto);
      expect(page).toBeInstanceOf(PaginatedPublishedPostsResponseDto);
      expect(comment).toBeInstanceOf(CommentResponseDto);
      expect(commentsPage).toBeInstanceOf(PaginatedCommentsResponseDto);
      expect(detail).toBeInstanceOf(PublishedPostResponseDto);
      expect(itinerarySummary).toBeInstanceOf(
        PublicItinerarySummaryResponseDto,
      );
      expect(itineraryPage).toBeInstanceOf(
        PaginatedPublicItinerariesResponseDto,
      );
      expect(authorPage).toBeInstanceOf(AuthorPageResponseDto);
      expect('comments' in detail).toBe(false);
    });
  });

  describe('CreateCommentDto & UpdateCommentDto (BLG-05, BLG-07)', () => {
    it('accepts boundary lengths 1 and 500 (after trimming) for both create and update', async () => {
      for (const metatype of [CreateCommentDto, UpdateCommentDto]) {
        const min = (await pipe.transform(
          { body: '  a  ' },
          { type: 'body', metatype },
        )) as CreateCommentDto;
        expect(min).toBeInstanceOf(metatype);
        expect(min.body).toBe('a');

        const max = (await pipe.transform(
          { body: 'a'.repeat(500) },
          { type: 'body', metatype },
        )) as CreateCommentDto;
        expect(max.body).toHaveLength(500);

        const paddedMax = (await pipe.transform(
          { body: `  ${'b'.repeat(500)}\n` },
          { type: 'body', metatype },
        )) as CreateCommentDto;
        expect(paddedMax.body).toBe('b'.repeat(500));
      }
    });

    it('rejects 0 chars, whitespace-only input, and 501 chars with VALIDATION_FAILED', async () => {
      for (const metatype of [CreateCommentDto, UpdateCommentDto]) {
        for (const invalidBody of ['', '   ', '\t\n ', 'a'.repeat(501)]) {
          await expectValidationError(
            pipe.transform({ body: invalidBody }, { type: 'body', metatype }),
            'body',
          );
        }
      }
    });

    it('rejects missing, null, non-string body and non-whitelisted fields', async () => {
      for (const metatype of [CreateCommentDto, UpdateCommentDto]) {
        await expectValidationError(
          pipe.transform({}, { type: 'body', metatype }),
          'body',
        );
        await expectValidationError(
          pipe.transform({ body: null }, { type: 'body', metatype }),
          'body',
        );
        await expectValidationError(
          pipe.transform({ body: 12345 }, { type: 'body', metatype }),
          'body',
        );

        for (const extra of [
          { postId: '507f1f77bcf86cd799439011' },
          { authorId: '507f1f77bcf86cd799439011' },
          { isHidden: true },
          { _id: '507f1f77bcf86cd799439011' },
        ]) {
          await expectValidationError(
            pipe.transform(
              { body: 'Valid comment', ...extra },
              { type: 'body', metatype },
            ),
          );
        }
      }
    });
  });

  describe('Tag normalisation & limits (BLG-08)', () => {
    it('normalises single tags and deduplicates tag lists cleanly', () => {
      expect(normalizeTag('Travel')).toBe('travel');
      expect(normalizeTag('TRAVEL')).toBe('travel');
      expect(normalizeTag('  travel  ')).toBe('travel');
      expect(normalizeTag('\tEgypt-2026\n')).toBe('egypt-2026');
      expect(normalizeTag('  Red Sea  ')).toBe('red sea');
      expect(normalizeTag('siwa_oasis')).toBe('siwa_oasis');
      expect(normalizeTag('  Café & Tea  ')).toBe('café & tea');
      expect(normalizeTag('')).toBe('');
      expect(normalizeTag('   ')).toBe('');

      expect(normalizeTags(['Travel', ' travel ', 'TRAVEL'])).toEqual([
        'travel',
      ]);
      expect(
        normalizeTags(['Egypt', '  nile  ', 'EGYPT', 'Cairo', 'NILE']),
      ).toEqual(['egypt', 'nile', 'cairo']);
      expect(normalizeTags(['', '   '])).toEqual(['']);
    });

    it('accepts 0, 1, and 5 tags and 1- and 30-char boundaries while deduplicating', async () => {
      const zero = (await pipe.transform(
        { title: 'Post', body: 'Body', status: PostStatus.DRAFT, tags: [] },
        { type: 'body', metatype: CreatePostDto },
      )) as CreatePostDto;
      expect(zero.tags).toEqual([]);

      const one = (await pipe.transform(
        {
          title: 'Post',
          body: 'Body',
          status: PostStatus.DRAFT,
          tags: ['a'],
        },
        { type: 'body', metatype: CreatePostDto },
      )) as CreatePostDto;
      expect(one.tags).toEqual(['a']);

      const maxTags = ['t1', 't2', 't3', 't4', 't5'];
      const five = (await pipe.transform(
        {
          title: 'Post',
          body: 'Body',
          status: PostStatus.PUBLISHED,
          tags: maxTags,
        },
        { type: 'body', metatype: CreatePostDto },
      )) as CreatePostDto;
      expect(five.tags).toEqual(maxTags);

      const paddedAndDeduped = (await pipe.transform(
        {
          tags: [
            'Travel',
            ' travel ',
            'TRAVEL',
            '  Egypt-2026  ',
            `  ${'b'.repeat(30)} `,
            'C',
            'd',
          ],
        },
        { type: 'body', metatype: UpdatePostDto },
      )) as UpdatePostDto;
      expect(paddedAndDeduped.tags).toEqual([
        'travel',
        'egypt-2026',
        'b'.repeat(30),
        'c',
        'd',
      ]);
    });

    it('rejects > 5 distinct tags, empty/whitespace-only tags, > 30-char tags, and invalid types', async () => {
      const baseCreate = {
        title: 'Post',
        body: 'Body',
        status: PostStatus.PUBLISHED,
      };
      for (const invalidTags of [
        ['t1', 't2', 't3', 't4', 't5', 't6'],
        [''],
        ['   '],
        ['travel', '\t\n '],
        ['a'.repeat(31)],
        null,
        'egypt',
        [123],
      ]) {
        await expectValidationError(
          pipe.transform(
            { ...baseCreate, tags: invalidTags },
            { type: 'body', metatype: CreatePostDto },
          ),
          'tags',
        );
        await expectValidationError(
          pipe.transform(
            { tags: invalidTags },
            { type: 'body', metatype: UpdatePostDto },
          ),
          'tags',
        );
      }
    });
  });

  describe('AuthorPageQueryDto (BLG-12)', () => {
    it('defaults page/limit and itinerariesPage/itinerariesLimit and coerces query string integers', async () => {
      const defaults = (await pipe.transform(
        {},
        { type: 'query', metatype: AuthorPageQueryDto },
      )) as AuthorPageQueryDto;
      expect(defaults).toBeInstanceOf(AuthorPageQueryDto);
      expect(defaults).toMatchObject({
        page: 1,
        limit: 10,
        itinerariesPage: 1,
        itinerariesLimit: 10,
      });

      const parsed = (await pipe.transform(
        {
          page: '2',
          limit: '25',
          itinerariesPage: '3',
          itinerariesLimit: '50',
        },
        { type: 'query', metatype: AuthorPageQueryDto },
      )) as AuthorPageQueryDto;
      expect(parsed).toMatchObject({
        page: 2,
        limit: 25,
        itinerariesPage: 3,
        itinerariesLimit: 50,
      });
    });

    it('rejects out-of-range or non-numeric itinerariesPage and itinerariesLimit values with VALIDATION_FAILED', async () => {
      for (const [query, expectedField] of [
        [{ itinerariesPage: '0' }, 'itinerariesPage'],
        [{ itinerariesPage: 'abc' }, 'itinerariesPage'],
        [{ itinerariesLimit: '0' }, 'itinerariesLimit'],
        [{ itinerariesLimit: '51' }, 'itinerariesLimit'],
        [{ itinerariesLimit: 'abc' }, 'itinerariesLimit'],
      ] as const) {
        await expectValidationError(
          pipe.transform(query, {
            type: 'query',
            metatype: AuthorPageQueryDto,
          }),
          expectedField,
        );
      }
    });
  });
});
