import { Types } from 'mongoose';
import type { Model, Schema } from 'mongoose';
import {
  Comment,
  CommentSchema,
} from '../../src/modules/blog/schemas/comment.schema.js';
import {
  Like,
  LikeSchema,
} from '../../src/modules/blog/schemas/like.schema.js';
import {
  Post,
  PostSchema,
} from '../../src/modules/blog/schemas/post.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

function postDoc(overrides: Record<string, unknown> = {}) {
  return {
    authorId: new Types.ObjectId(),
    title: 'Three days in Cairo',
    body: 'Start at the pyramids early.',
    status: 'draft' as const,
    ...overrides,
  };
}

function commentDoc(overrides: Record<string, unknown> = {}) {
  return {
    postId: new Types.ObjectId(),
    authorId: new Types.ObjectId(),
    body: 'Great tips!',
    ...overrides,
  };
}

function likeDoc(overrides: Record<string, unknown> = {}) {
  return {
    postId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    ...overrides,
  };
}

function images(count: number) {
  return Array.from({ length: count }, (_, i) => ({ key: `img-${i}.jpg` }));
}

function indexSummary(indexes: { key: unknown; unique?: boolean }[]) {
  return indexes.map((index) => ({
    key: index.key,
    unique: index.unique ?? false,
  }));
}

describe('blog schemas', () => {
  let db: TestDatabase;
  let posts: Model<Post>;
  let comments: Model<Comment>;
  let likes: Model<Like>;

  beforeAll(async () => {
    db = await startTestDatabase('blog');
    posts = db.connection.model<Post>(Post.name, PostSchema);
    comments = db.connection.model<Comment>(Comment.name, CommentSchema);
    likes = db.connection.model<Like>(Like.name, LikeSchema);
    await Promise.all([posts.init(), comments.init(), likes.init()]);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await Promise.all([
      posts.deleteMany({}),
      comments.deleteMany({}),
      likes.deleteMany({}),
    ]);
  });

  it('uses the posts, comments and likes collections', () => {
    expect(posts.collection.collectionName).toBe('posts');
    expect(comments.collection.collectionName).toBe('comments');
    expect(likes.collection.collectionName).toBe('likes');
  });

  it('declares no ref and stores every reference as an ObjectId', () => {
    const schemas: Schema[] = [PostSchema, CommentSchema, LikeSchema];
    for (const schema of schemas) {
      schema.eachPath((path, type) => {
        const options = type.options as { ref?: unknown; refPath?: unknown };
        expect(options.ref, path).toBeUndefined();
        expect(options.refPath, path).toBeUndefined();
      });
    }
    expect(PostSchema.path('authorId').instance).toBe('ObjectId');
    expect(PostSchema.path('itineraryId').instance).toBe('ObjectId');
    expect(CommentSchema.path('postId').instance).toBe('ObjectId');
    expect(CommentSchema.path('authorId').instance).toBe('ObjectId');
    expect(LikeSchema.path('postId').instance).toBe('ObjectId');
    expect(LikeSchema.path('userId').instance).toBe('ObjectId');
  });

  describe('posts', () => {
    it('saves a valid post with the defaults', async () => {
      const post = await posts.create(postDoc());
      expect(post.tags).toEqual([]);
      expect(post.images).toEqual([]);
      expect(post.likeCount).toBe(0);
      expect(post.commentCount).toBe(0);
      expect(post.isHidden).toBe(false);
      expect(post.authorDeactivated).toBe(false);
      expect(post.publishedAt).toBeUndefined();
      expect(post.get('itineraryId')).toBeUndefined();
      expect(post.get('createdAt')).toBeInstanceOf(Date);
      expect(post.get('updatedAt')).toBeInstanceOf(Date);
    });

    it('requires authorId, title, body and status, with no default status', async () => {
      for (const field of ['authorId', 'title', 'body', 'status']) {
        await expect(
          new posts(postDoc({ [field]: undefined })).validate(),
        ).rejects.toThrow(new RegExp(`${field}.*required`));
      }
      await expect(new posts(postDoc()).validate()).resolves.toBeUndefined();
    });

    it('rejects an invalid authorId', async () => {
      await expect(
        new posts(postDoc({ authorId: 'abc' })).validate(),
      ).rejects.toThrow(/authorId/);
      await expect(
        new posts(
          postDoc({ authorId: new Types.ObjectId().toHexString() }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('persists an optional itinerary reference without embedding itinerary data', async () => {
      const itineraryId = new Types.ObjectId();
      const post = await posts.create(postDoc({ itineraryId }));
      const stored = await posts.collection.findOne({ _id: post._id });
      expect(stored?.itineraryId).toEqual(itineraryId);
      expect(stored).not.toHaveProperty('itinerary');
    });

    it('casts a hex itinerary ID and rejects malformed references', async () => {
      const itineraryId = new Types.ObjectId().toHexString();
      const post = await posts.create(postDoc({ itineraryId }));
      const stored = await posts.collection.findOne({ _id: post._id });
      expect(stored?.itineraryId).toEqual(new Types.ObjectId(itineraryId));

      for (const invalid of ['abc', { title: 'Private trip' }, [itineraryId]]) {
        await expect(
          new posts(postDoc({ itineraryId: invalid })).validate(),
        ).rejects.toThrow(/itineraryId/);
      }
    });

    it('accepts only draft or published', async () => {
      await expect(
        new posts(postDoc({ status: 'archived' })).validate(),
      ).rejects.toThrow(/status/);
      for (const status of ['draft', 'published']) {
        await expect(
          new posts(
            postDoc({ status, publishedAt: new Date('2026-01-01') }),
          ).validate(),
        ).resolves.toBeUndefined();
      }
    });

    it('trims the title and limits it to 1-150 chars', async () => {
      for (const title of ['   ', 'a'.repeat(151)]) {
        await expect(new posts(postDoc({ title })).validate()).rejects.toThrow(
          /title/,
        );
      }
      const post = new posts(postDoc({ title: `  ${'a'.repeat(150)}  ` }));
      await expect(post.validate()).resolves.toBeUndefined();
      expect(post.title).toBe('a'.repeat(150));
    });

    it('limits the body to 1-20000 chars', async () => {
      for (const body of ['', 'a'.repeat(20001)]) {
        await expect(new posts(postDoc({ body })).validate()).rejects.toThrow(
          /body/,
        );
      }
      for (const body of ['a', 'a'.repeat(20000)]) {
        await expect(
          new posts(postDoc({ body })).validate(),
        ).resolves.toBeUndefined();
      }
    });

    it('accepts at most 5 tags', async () => {
      await expect(
        new posts(postDoc({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).validate(),
      ).rejects.toThrow(/tags/);
      await expect(
        new posts(postDoc({ tags: ['a', 'b', 'c', 'd', 'e'] })).validate(),
      ).resolves.toBeUndefined();
    });

    it('limits each tag to 1-30 chars after trimming', async () => {
      for (const tag of ['a'.repeat(31), '   ']) {
        await expect(
          new posts(postDoc({ tags: [tag] })).validate(),
        ).rejects.toThrow(/tags/);
      }
      await expect(
        new posts(postDoc({ tags: ['a'.repeat(30)] })).validate(),
      ).resolves.toBeUndefined();
    });

    it('trims and lowercases tags, then rejects duplicates', async () => {
      const post = await posts.create(postDoc({ tags: ['  Egypt ', 'NILE'] }));
      expect(post.tags).toEqual(['egypt', 'nile']);
      const stored = await posts.collection.findOne({ _id: post._id });
      expect(stored?.tags).toEqual(['egypt', 'nile']);

      await expect(
        new posts(postDoc({ tags: ['Egypt', ' egypt '] })).validate(),
      ).rejects.toThrow(/tags/);
      await expect(
        new posts(postDoc({ tags: ['Egypt', 'egypt-food'] })).validate(),
      ).resolves.toBeUndefined();
    });

    it('accepts at most 5 images', async () => {
      await expect(
        new posts(postDoc({ images: images(6) })).validate(),
      ).rejects.toThrow(/images/);
      await expect(
        new posts(postDoc({ images: images(5) })).validate(),
      ).resolves.toBeUndefined();
    });

    it('requires likeCount and commentCount to be non-negative integers', async () => {
      for (const field of ['likeCount', 'commentCount']) {
        for (const value of [-1, 1.5]) {
          await expect(
            new posts(postDoc({ [field]: value })).validate(),
          ).rejects.toThrow(new RegExp(field));
        }
        await expect(
          new posts(postDoc({ [field]: 3 })).validate(),
        ).resolves.toBeUndefined();
      }
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await posts.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          {
            key: {
              status: 1,
              isHidden: 1,
              authorDeactivated: 1,
              publishedAt: -1,
            },
            unique: false,
          },
          { key: { authorId: 1, updatedAt: -1 }, unique: false },
          { key: { tags: 1, status: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(4);
    });
  });

  describe('comments', () => {
    it('saves a valid comment, not hidden by default', async () => {
      const comment = await comments.create(commentDoc());
      expect(comment.isHidden).toBe(false);
      expect(comment.get('createdAt')).toBeInstanceOf(Date);
    });

    it('requires postId, authorId and body', async () => {
      for (const field of ['postId', 'authorId', 'body']) {
        await expect(
          new comments(commentDoc({ [field]: undefined })).validate(),
        ).rejects.toThrow(new RegExp(`${field}.*required`));
      }
      await expect(
        new comments(commentDoc()).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects an invalid postId', async () => {
      await expect(
        new comments(commentDoc({ postId: 'abc' })).validate(),
      ).rejects.toThrow(/postId/);
      await expect(
        new comments(
          commentDoc({ postId: new Types.ObjectId().toHexString() }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('trims the body and limits it to 1-500 chars', async () => {
      for (const body of ['', '   ', 'a'.repeat(501)]) {
        await expect(
          new comments(commentDoc({ body })).validate(),
        ).rejects.toThrow(/body/);
      }
      const comment = new comments(
        commentDoc({ body: `  ${'a'.repeat(500)}  ` }),
      );
      await expect(comment.validate()).resolves.toBeUndefined();
      expect(comment.body).toBe('a'.repeat(500));
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await comments.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          { key: { postId: 1, createdAt: 1 }, unique: false },
          { key: { authorId: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(3);
    });
  });

  describe('likes', () => {
    it('requires postId and userId', async () => {
      for (const field of ['postId', 'userId']) {
        await expect(
          new likes(likeDoc({ [field]: undefined })).validate(),
        ).rejects.toThrow(new RegExp(`${field}.*required`));
      }
      await expect(new likes(likeDoc()).validate()).resolves.toBeUndefined();
    });

    it('rejects an invalid userId', async () => {
      await expect(
        new likes(likeDoc({ userId: 'abc' })).validate(),
      ).rejects.toThrow(/userId/);
      await expect(
        new likes(
          likeDoc({ userId: new Types.ObjectId().toHexString() }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a second like by the same user on the same post', async () => {
      const postId = new Types.ObjectId();
      const userId = new Types.ObjectId();
      await likes.create(likeDoc({ postId, userId }));
      await expect(
        likes.create(likeDoc({ postId, userId })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        likes.create(likeDoc({ postId, userId: new Types.ObjectId() })),
      ).resolves.toBeDefined();
      await expect(
        likes.create(likeDoc({ postId: new Types.ObjectId(), userId })),
      ).resolves.toBeDefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await likes.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          { key: { postId: 1, userId: 1 }, unique: true },
          { key: { userId: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(3);
    });
  });
});
