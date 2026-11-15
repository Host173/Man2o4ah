import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { vi } from 'vitest';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { BlogModule } from './blog.module.js';
import { BlogService } from './blog.service.js';
import { Comment, type CommentDocument } from './schemas/comment.schema.js';
import { Like, type LikeDocument } from './schemas/like.schema.js';
import { Post, PostStatus, type PostDocument } from './schemas/post.schema.js';

describe('BlogService (skeleton)', () => {
  it('Provides and exports BlogService from BlogModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BlogModule],
    })
      .useMocker((token) => (token === getConnectionToken() ? {} : undefined))
      .overrideProvider(getModelToken(Post.name))
      .useValue({})
      .overrideProvider(getModelToken(Comment.name))
      .useValue({})
      .overrideProvider(getModelToken(Like.name))
      .useValue({})
      .compile();

    expect(moduleRef.get(BlogService)).toBeInstanceOf(BlogService);
  });
});

describe('BlogService (BLG-01, BLG-03, BLG-04 integration)', () => {
  let testApp: TestApp | undefined;
  let service: BlogService;
  let postModel: Model<PostDocument>;
  let commentModel: Model<CommentDocument>;
  let likeModel: Model<LikeDocument>;

  const ownerId = new Types.ObjectId().toHexString();
  const otherUserId = new Types.ObjectId().toHexString();

  beforeAll(async () => {
    testApp = await createTestApp({ imports: [BlogModule] });
    service = testApp.moduleRef.get(BlogService);
    postModel = testApp.moduleRef.get<Model<PostDocument>>(
      getModelToken(Post.name),
    );
    commentModel = testApp.moduleRef.get<Model<CommentDocument>>(
      getModelToken(Comment.name),
    );
    likeModel = testApp.moduleRef.get<Model<LikeDocument>>(
      getModelToken(Like.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    if (testApp) {
      await clearCollections(testApp.connection);
    }
  });

  afterAll(async () => {
    await testApp?.close();
  }, HOOK_TIMEOUT);

  describe('create (BLG-01)', () => {
    it('creates a draft post without publishedAt, trims title, and preserves body spaces', async () => {
      const created = await service.create(
        {
          title: '  Luxor Sunrise  ',
          body: '  Hot air balloons over the Valley of the Kings.  ',
          status: PostStatus.DRAFT,
        },
        ownerId,
      );

      expect(created._id).toMatch(/^[0-9a-f]{24}$/);
      expect(created.authorId).toBe(ownerId);
      expect(created.title).toBe('Luxor Sunrise');
      expect(created.body).toBe(
        '  Hot air balloons over the Valley of the Kings.  ',
      );
      expect(created.status).toBe(PostStatus.DRAFT);
      expect(created.publishedAt).toBeUndefined();
      expect(created.tags).toEqual([]);
      expect(created.images).toEqual([]);
      expect(created.likeCount).toBe(0);
      expect(created.commentCount).toBe(0);
      expect(created.isHidden).toBe(false);
      expect(created.authorDeactivated).toBe(false);
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);
    });

    it('creates a published post with publishedAt set', async () => {
      const created = await service.create(
        {
          title: 'Alexandria Guide',
          body: 'Fresh seafood by Qaitbay Citadel.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );

      expect(created.status).toBe(PostStatus.PUBLISHED);
      expect(created.publishedAt).toBeInstanceOf(Date);
    });

    it('rejects malformed authorId and blank body with VALIDATION_FAILED', async () => {
      await expect(
        service.create(
          { title: 'Title', body: 'Body', status: PostStatus.DRAFT },
          'not-an-object-id',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.create(
          { title: 'Title', body: '    ', status: PostStatus.DRAFT },
          ownerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listMine (BLG-03)', () => {
    it('returns owner drafts, published, and hidden posts newest updatedAt first and excludes others', async () => {
      const first = await service.create(
        { title: 'First Draft', body: 'One', status: PostStatus.DRAFT },
        ownerId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const second = await service.create(
        {
          title: 'Second Published',
          body: 'Two',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      await service.create(
        { title: 'Other Draft', body: 'Private', status: PostStatus.DRAFT },
        otherUserId,
      );
      await service.create(
        {
          title: 'Other Published',
          body: 'Public',
          status: PostStatus.PUBLISHED,
        },
        otherUserId,
      );

      // Update first post so its updatedAt becomes newer than second, and verify image subdocs map cleanly.
      await new Promise((resolve) => setTimeout(resolve, 10));
      const imageId = new Types.ObjectId();
      await postModel.updateOne(
        { _id: new Types.ObjectId(first._id) },
        {
          $set: {
            isHidden: true,
            tags: ['egypt'],
            images: [{ _id: imageId, key: 'blog/post-1.webp' }],
          },
        },
      );

      const result = await service.listMine(ownerId);

      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(result.items.map((item) => item._id)).toEqual([
        first._id,
        second._id,
      ]);
      expect(result.items[0].status).toBe(PostStatus.DRAFT);
      expect(result.items[0].isHidden).toBe(true);
      expect(result.items[0].tags).toEqual(['egypt']);
      expect(result.items[0].images).toEqual([
        { _id: imageId.toHexString(), key: 'blog/post-1.webp' },
      ]);
      expect(result.items[1].status).toBe(PostStatus.PUBLISHED);
    });

    it('paginates results cleanly and returns empty page when user has no posts', async () => {
      for (let i = 1; i <= 3; i += 1) {
        await service.create(
          { title: `Post ${i}`, body: `Body ${i}`, status: PostStatus.DRAFT },
          ownerId,
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const query = new PaginationQueryDto();
      query.page = 2;
      query.limit = 2;

      const page2 = await service.listMine(ownerId, query);
      expect(page2.page).toBe(2);
      expect(page2.limit).toBe(2);
      expect(page2.total).toBe(3);
      expect(page2.totalPages).toBe(2);
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0].title).toBe('Post 1');

      const empty = await service.listMine(otherUserId);
      expect(empty.items).toEqual([]);
      expect(empty.total).toBe(0);
      expect(empty.totalPages).toBe(0);
    });
  });

  describe('update (BLG-04)', () => {
    it('updates fields on own post, sets publishedAt once on first publish, and handles empty updates', async () => {
      const draft = await service.create(
        {
          title: 'Initial Title',
          body: 'Initial Body',
          status: PostStatus.DRAFT,
        },
        ownerId,
      );

      const unchanged = await service.update(draft._id, {}, ownerId);
      expect(unchanged.title).toBe('Initial Title');
      expect(unchanged.publishedAt).toBeUndefined();

      const editedDraft = await service.update(
        draft._id,
        { title: 'Edited Draft' },
        ownerId,
      );
      expect(editedDraft.title).toBe('Edited Draft');
      expect(editedDraft.body).toBe('Initial Body');
      expect(editedDraft.status).toBe(PostStatus.DRAFT);
      expect(editedDraft.publishedAt).toBeUndefined();

      const published = await service.update(
        draft._id,
        { status: PostStatus.PUBLISHED, body: 'Published Body' },
        ownerId,
      );
      expect(published.status).toBe(PostStatus.PUBLISHED);
      expect(published.body).toBe('Published Body');
      expect(published.publishedAt).toBeInstanceOf(Date);
      const originalPublishedAt = published.publishedAt!.getTime();

      await service.update(draft._id, { status: PostStatus.DRAFT }, ownerId);
      const republished = await service.update(
        draft._id,
        { status: PostStatus.PUBLISHED },
        ownerId,
      );
      expect(republished.publishedAt?.getTime()).toBe(originalPublishedAt);
    });

    it('throws NOT_FOUND without mutating when post is missing or owned by another user', async () => {
      const ownersDraft = await service.create(
        { title: 'Owner Draft', body: 'Secret', status: PostStatus.DRAFT },
        ownerId,
      );
      const ownersPublished = await service.create(
        { title: 'Owner Pub', body: 'Public', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const missingId = new Types.ObjectId().toHexString();

      for (const targetId of [
        ownersDraft._id,
        ownersPublished._id,
        missingId,
      ]) {
        try {
          await service.update(targetId, { title: 'Hijacked' }, otherUserId);
          expect.unreachable('Expected NotFoundException');
        } catch (err) {
          expect(err).toBeInstanceOf(NotFoundException);
          expect((err as NotFoundException).getResponse()).toMatchObject({
            code: ErrorCode.NotFound,
          });
        }
      }

      const persistedDraft = await postModel
        .findById(ownersDraft._id)
        .lean()
        .exec();
      expect(persistedDraft?.title).toBe('Owner Draft');
    });

    it('rejects malformed postId and blank body with VALIDATION_FAILED', async () => {
      const created = await service.create(
        { title: 'Title', body: 'Body', status: PostStatus.DRAFT },
        ownerId,
      );

      await expect(
        service.update('bad-id', { title: 'Test' }, ownerId),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.update(created._id, { body: '    ' }, ownerId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete (BLG-04)', () => {
    it('deletes own post and cleans up its comments and likes without touching other posts', async () => {
      const target = await service.create(
        { title: 'To Delete', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const bystander = await service.create(
        { title: 'Keep Me', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );

      const targetObjectId = new Types.ObjectId(target._id);
      const bystanderObjectId = new Types.ObjectId(bystander._id);
      const commenterObjectId = new Types.ObjectId(otherUserId);

      await commentModel.create([
        {
          postId: targetObjectId,
          authorId: commenterObjectId,
          body: 'Nice post!',
        },
        {
          postId: bystanderObjectId,
          authorId: commenterObjectId,
          body: 'Keep comment!',
        },
      ]);
      await likeModel.create([
        { postId: targetObjectId, userId: commenterObjectId },
        { postId: bystanderObjectId, userId: commenterObjectId },
      ]);

      await service.delete(target._id, ownerId);

      expect(await postModel.findById(target._id).exec()).toBeNull();
      expect(
        await commentModel.countDocuments({ postId: targetObjectId }).exec(),
      ).toBe(0);
      expect(
        await likeModel.countDocuments({ postId: targetObjectId }).exec(),
      ).toBe(0);

      expect(await postModel.findById(bystander._id).exec()).not.toBeNull();
      expect(
        await commentModel.countDocuments({ postId: bystanderObjectId }).exec(),
      ).toBe(1);
      expect(
        await likeModel.countDocuments({ postId: bystanderObjectId }).exec(),
      ).toBe(1);

      // Repeated delete returns NOT_FOUND.
      await expect(service.delete(target._id, ownerId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NOT_FOUND and leaves post, comments, and likes intact when called by non-owner or on missing post', async () => {
      const ownersDraft = await service.create(
        { title: 'Protected Draft', body: 'Body', status: PostStatus.DRAFT },
        ownerId,
      );
      await commentModel.create({
        postId: new Types.ObjectId(ownersDraft._id),
        authorId: new Types.ObjectId(ownerId),
        body: 'Author note',
      });

      await expect(
        service.delete(ownersDraft._id, otherUserId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.delete(new Types.ObjectId().toHexString(), ownerId),
      ).rejects.toThrow(NotFoundException);

      expect(await postModel.findById(ownersDraft._id).exec()).not.toBeNull();
      expect(
        await commentModel
          .countDocuments({ postId: new Types.ObjectId(ownersDraft._id) })
          .exec(),
      ).toBe(1);
    });

    it('rejects malformed postId with VALIDATION_FAILED', async () => {
      await expect(service.delete('bad-id', ownerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rolls back post and comment deletions if like deletion fails mid-transaction', async () => {
      const target = await service.create(
        { title: 'Atomic Post', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const targetObjectId = new Types.ObjectId(target._id);
      const commenterObjectId = new Types.ObjectId(otherUserId);

      await commentModel.create({
        postId: targetObjectId,
        authorId: commenterObjectId,
        body: 'Keep me on rollback',
      });
      await likeModel.create({
        postId: targetObjectId,
        userId: commenterObjectId,
      });

      const spy = vi.spyOn(likeModel, 'deleteMany').mockImplementation(
        () =>
          ({
            exec: () => Promise.reject(new Error('like cleanup failed')),
          }) as never,
      );

      try {
        await expect(service.delete(target._id, ownerId)).rejects.toThrow(
          'like cleanup failed',
        );
      } finally {
        spy.mockRestore();
      }

      expect(await postModel.findById(target._id).exec()).not.toBeNull();
      expect(
        await commentModel.countDocuments({ postId: targetObjectId }).exec(),
      ).toBe(1);
      expect(
        await likeModel.countDocuments({ postId: targetObjectId }).exec(),
      ).toBe(1);
    });
  });
});
