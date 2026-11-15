import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../../common/errors/validation-exception.factory.js';
import { PostStatus } from '../schemas/post.schema.js';
import { CreatePostDto } from './create-post.dto.js';
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
    it('accepts valid draft and published payloads and trims title whitespace', async () => {
      const draft = (await pipe.transform(
        {
          title: '  Cairo Weekend Notes  ',
          body: 'Walked along the Nile at sunset.',
          status: PostStatus.DRAFT,
        },
        { type: 'body', metatype: CreatePostDto },
      )) as CreatePostDto;

      expect(draft).toBeInstanceOf(CreatePostDto);
      expect(draft.title).toBe('Cairo Weekend Notes');
      expect(draft.body).toBe('Walked along the Nile at sunset.');
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
});
