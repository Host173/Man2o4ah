import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../../common/errors/validation-exception.factory.js';
import { PostStatus } from '../schemas/post.schema.js';
import { CreateCommentDto } from './create-comment.dto.js';
import { CreatePostDto } from './create-post.dto.js';
import { ListPostsQueryDto } from './list-posts-query.dto.js';
import {
  CommentResponseDto,
  PaginatedCommentsResponseDto,
  PaginatedPublishedPostsResponseDto,
  PostDetailResponseDto,
  PostLikeResponseDto,
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
        { tags: ['cairo'] },
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
      const like = new PostLikeResponseDto();

      expect(published).toBeInstanceOf(PublishedPostResponseDto);
      expect(page).toBeInstanceOf(PaginatedPublishedPostsResponseDto);
      expect(comment).toBeInstanceOf(CommentResponseDto);
      expect(commentsPage).toBeInstanceOf(PaginatedCommentsResponseDto);
      expect(detail).toBeInstanceOf(PublishedPostResponseDto);
      expect(like).toBeInstanceOf(PostLikeResponseDto);
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
});
