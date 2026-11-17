import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { vi } from 'vitest';
import { FakeAccountsService } from '../../../test/fakes/accounts.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { Session } from '../accounts/schemas/session.schema.js';
import { User, UserStatus } from '../accounts/schemas/user.schema.js';
import { BlogModule } from './blog.module.js';
import { BlogService } from './blog.service.js';
import { ListPostsQueryDto } from './dto/list-posts-query.dto.js';
import { Comment, type CommentDocument } from './schemas/comment.schema.js';
import { Like, type LikeDocument } from './schemas/like.schema.js';
import { Post, PostStatus, type PostDocument } from './schemas/post.schema.js';

describe('BlogService (skeleton)', () => {
  it('Provides and exports BlogService from BlogModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BlogModule],
    })
      .useMocker((token) => {
        if (token === getConnectionToken()) return {};
        if (token === ConfigService) {
          return { getOrThrow: () => 'test-secret-with-at-least-32-chars' };
        }
        return undefined;
      })
      .overrideProvider(getModelToken(Post.name))
      .useValue({})
      .overrideProvider(getModelToken(Comment.name))
      .useValue({})
      .overrideProvider(getModelToken(Like.name))
      .useValue({})
      .overrideProvider(getModelToken(User.name))
      .useValue({})
      .overrideProvider(getModelToken(Session.name))
      .useValue({})
      .compile();

    expect(moduleRef.get(BlogService)).toBeInstanceOf(BlogService);
  });
});

describe('BlogService (BLG-01, BLG-02, BLG-03, BLG-04, ACC-12 integration)', () => {
  let testApp: TestApp | undefined;
  let service: BlogService;
  const fakeAccounts = new FakeAccountsService();
  let appEvents: AppEvents;
  let eventEmitter: EventEmitter2;
  let postModel: Model<PostDocument>;
  let commentModel: Model<CommentDocument>;
  let likeModel: Model<LikeDocument>;

  const ownerId = new Types.ObjectId().toHexString();
  const otherUserId = new Types.ObjectId().toHexString();
  const suspendedUserId = new Types.ObjectId().toHexString();
  const activeCommenterId = new Types.ObjectId().toHexString();
  const deactivatedCommenterId = new Types.ObjectId().toHexString();
  const deactivatedAuthorId = new Types.ObjectId().toHexString();

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [BlogModule],
      override: (builder) =>
        builder.overrideProvider(AccountsService).useValue(fakeAccounts),
    });
    service = testApp.moduleRef.get(BlogService);
    appEvents = testApp.moduleRef.get(AppEvents);
    eventEmitter = testApp.moduleRef.get(EventEmitter2);
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
    vi.restoreAllMocks();
    Object.assign(
      fakeAccounts,
      new FakeAccountsService([
        {
          id: ownerId,
          name: 'Aisha Rawahi',
          email: 'aisha@example.com',
          status: UserStatus.ACTIVE,
        },
        {
          id: otherUserId,
          name: 'Bob Nomad',
          email: 'bob@example.com',
          status: UserStatus.ACTIVE,
        },
        {
          id: suspendedUserId,
          name: 'Suspended Author',
          email: 'suspended@example.com',
          status: UserStatus.SUSPENDED,
        },
        {
          id: activeCommenterId,
          name: 'Omar Said',
          email: 'omar@example.com',
          status: UserStatus.ACTIVE,
        },
        {
          id: deactivatedCommenterId,
          name: 'Former Traveler',
          email: 'former@example.com',
          status: UserStatus.DEACTIVATED,
        },
        {
          id: deactivatedAuthorId,
          name: 'Deactivated Author',
          email: 'deactivated@example.com',
          status: UserStatus.DEACTIVATED,
        },
      ]),
    );
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

  describe('listPublished (BLG-02)', () => {
    it('returns published non-hidden active posts newest publishedAt first with resolved author names', async () => {
      const older = await service.create(
        { title: 'Older Post', body: 'Body 1', status: PostStatus.PUBLISHED },
        ownerId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const newer = await service.create(
        { title: 'Newer Post', body: 'Body 2', status: PostStatus.PUBLISHED },
        suspendedUserId,
      );
      const draft = await service.create(
        { title: 'Hidden Draft', body: 'Draft', status: PostStatus.DRAFT },
        ownerId,
      );
      const hidden = await service.create(
        {
          title: 'Moderated Out',
          body: 'Moderated',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      const deactivatedPost = await service.create(
        {
          title: 'Deactivated Author Post',
          body: 'Hidden',
          status: PostStatus.PUBLISHED,
        },
        otherUserId,
      );

      const olderImageId = new Types.ObjectId();
      await postModel.updateOne(
        { _id: new Types.ObjectId(older._id) },
        {
          $set: {
            tags: ['cairo', 'nile'],
            images: [{ _id: olderImageId, key: 'blog/cairo.jpg' }],
          },
        },
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden._id) },
        { $set: { isHidden: true } },
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(deactivatedPost._id) },
        { $set: { authorDeactivated: true } },
      );

      const result = await service.listPublished();

      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(result.items.map((p) => p._id)).toEqual([newer._id, older._id]);
      expect(result.items.map((p) => p._id)).not.toContain(draft._id);
      expect(result.items.map((p) => p._id)).not.toContain(hidden._id);
      expect(result.items.map((p) => p._id)).not.toContain(deactivatedPost._id);
      // Suspended user content remains visible per ACC-16.
      expect(result.items[0].authorName).toBe('Suspended Author');
      expect(result.items[1].authorName).toBe('Aisha Rawahi');
      expect(result.items[1].tags).toEqual(['cairo', 'nile']);
      expect(result.items[1].images).toEqual([
        { _id: olderImageId.toHexString(), key: 'blog/cairo.jpg' },
      ]);
    });

    it('filters by tag, handles pagination boundaries, and returns empty results for unknown tag', async () => {
      const p1 = await service.create(
        { title: 'Siwa 1', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p2 = await service.create(
        { title: 'Siwa 2', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p3 = await service.create(
        { title: 'Siwa 3', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const other = await service.create(
        { title: 'Aswan', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );

      await postModel.updateMany(
        {
          _id: {
            $in: [p1._id, p2._id, p3._id].map((id) => new Types.ObjectId(id)),
          },
        },
        { $set: { tags: ['oasis', 'siwa'] } },
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(other._id) },
        { $set: { tags: ['nubia'] } },
      );

      const query = new ListPostsQueryDto();
      query.tag = 'oasis';
      query.page = 2;
      query.limit = 2;

      const page2 = await service.listPublished(query);
      expect(page2.page).toBe(2);
      expect(page2.limit).toBe(2);
      expect(page2.total).toBe(3);
      expect(page2.totalPages).toBe(2);
      expect(page2.items.map((p) => p._id)).toEqual([p1._id]);
      expect(page2.items[0].authorName).toBe('Aisha Rawahi');

      const unknown = await service.listPublished({
        page: 1,
        limit: 10,
        tag: 'nonexistent',
      });
      expect(unknown).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('getById (BLG-02)', () => {
    it('returns published post with author name (including suspended author) and omits embedded comments', async () => {
      const post = await service.create(
        {
          title: 'Dahab Diving',
          body: 'Blue Hole tips and reef safety.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      const imageId = new Types.ObjectId();
      await postModel.updateOne(
        { _id: new Types.ObjectId(post._id) },
        {
          $set: {
            tags: ['red-sea'],
            images: [{ _id: imageId, key: 'blog/reef.png' }],
            likeCount: 4,
            commentCount: 2,
          },
        },
      );

      await commentModel.create({
        postId: new Types.ObjectId(post._id),
        authorId: new Types.ObjectId(activeCommenterId),
        body: 'Loaded separately via paginated comments endpoint',
      });

      const detail = await service.getById(post._id);

      expect(detail).toMatchObject({
        _id: post._id,
        authorId: ownerId,
        authorName: 'Aisha Rawahi',
        title: 'Dahab Diving',
        body: 'Blue Hole tips and reef safety.',
        tags: ['red-sea'],
        images: [{ _id: imageId.toHexString(), key: 'blog/reef.png' }],
        status: PostStatus.PUBLISHED,
        likeCount: 4,
        commentCount: 2,
        isHidden: false,
        authorDeactivated: false,
      });
      expect(detail.publishedAt).toBeInstanceOf(Date);
      expect('comments' in detail).toBe(false);

      // A suspended author's own post page still shows their author name (ACC-16).
      const suspendedPost = await service.create(
        {
          title: 'Suspended Author Post',
          body: 'Still publicly visible.',
          status: PostStatus.PUBLISHED,
        },
        suspendedUserId,
      );
      const suspendedDetail = await service.getById(suspendedPost._id);
      expect(suspendedDetail.authorName).toBe('Suspended Author');
    });

    it('throws 404 NOT_FOUND for missing, draft, hidden, or deactivated-author posts and 400 for invalid id', async () => {
      const draft = await service.create(
        { title: 'Draft', body: 'Body', status: PostStatus.DRAFT },
        ownerId,
      );
      const hidden = await service.create(
        { title: 'Hidden', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const deactivatedFlag = await service.create(
        { title: 'Deactivated', body: 'Body', status: PostStatus.PUBLISHED },
        otherUserId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden._id) },
        { $set: { isHidden: true } },
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(deactivatedFlag._id) },
        { $set: { authorDeactivated: true } },
      );

      for (const targetId of [
        new Types.ObjectId().toHexString(),
        draft._id,
        hidden._id,
        deactivatedFlag._id,
      ]) {
        try {
          await service.getById(targetId);
          expect.unreachable('Expected NotFoundException');
        } catch (err) {
          expect(err).toBeInstanceOf(NotFoundException);
          expect((err as NotFoundException).getResponse()).toMatchObject({
            code: ErrorCode.NotFound,
          });
        }
      }

      // Also throws 404 if AccountsService reports author status DEACTIVATED before event flag updates.
      const racePost = await service.create(
        { title: 'Race Post', body: 'Body', status: PostStatus.PUBLISHED },
        deactivatedAuthorId,
      );
      await expect(service.getById(racePost._id)).rejects.toThrow(
        NotFoundException,
      );

      await expect(service.getById('not-an-object-id')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('comments (BLG-05, BLG-07)', () => {
    it('creates comments on published posts, trims body, resolves author name, and increments commentCount atomically', async () => {
      const post = await service.create(
        {
          title: 'Siwa Spring',
          body: 'Travel notes',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );

      const created = await service.createComment(
        post._id,
        { body: '  Wonderful guide!  ' },
        activeCommenterId,
      );

      expect(created).toMatchObject({
        postId: post._id,
        authorId: activeCommenterId,
        authorName: 'Omar Said',
        body: 'Wonderful guide!',
        isHidden: false,
      });
      expect(created._id).toMatch(/^[0-9a-f]{24}$/);
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);

      const afterFirst = await postModel.findById(post._id).lean().exec();
      expect(afterFirst?.commentCount).toBe(1);

      const spy = vi
        .spyOn(commentModel, 'create')
        .mockRejectedValueOnce(new Error('comment insert failed'));
      try {
        await expect(
          service.createComment(
            post._id,
            { body: 'Will roll back' },
            activeCommenterId,
          ),
        ).rejects.toThrow('comment insert failed');
      } finally {
        spy.mockRestore();
      }

      const afterRollback = await postModel.findById(post._id).lean().exec();
      expect(afterRollback?.commentCount).toBe(1);
    });

    it('rejects creating comments on draft, hidden, deactivated-author, or missing posts without changing commentCount', async () => {
      const draft = await service.create(
        { title: 'Draft', body: 'Body', status: PostStatus.DRAFT },
        ownerId,
      );
      const hidden = await service.create(
        { title: 'Hidden', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const deactivated = await service.create(
        { title: 'Deactivated', body: 'Body', status: PostStatus.PUBLISHED },
        otherUserId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden._id) },
        { $set: { isHidden: true } },
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(deactivated._id) },
        { $set: { authorDeactivated: true } },
      );

      for (const postId of [
        draft._id,
        hidden._id,
        deactivated._id,
        new Types.ObjectId().toHexString(),
      ]) {
        await expect(
          service.createComment(
            postId,
            { body: 'Should fail' },
            activeCommenterId,
          ),
        ).rejects.toThrow(NotFoundException);
      }

      for (const postId of [draft._id, hidden._id, deactivated._id]) {
        const doc = await postModel.findById(postId).lean().exec();
        expect(doc?.commentCount).toBe(0);
      }

      await expect(
        service.createComment(
          'bad-id',
          { body: 'Valid body' },
          activeCommenterId,
        ),
      ).rejects.toThrow(BadRequestException);
      for (const badBody of ['', '   ', 'a'.repeat(501)]) {
        await expect(
          service.createComment(
            hidden._id,
            { body: badBody },
            activeCommenterId,
          ),
        ).rejects.toThrow(BadRequestException);
      }
      await expect(
        service.createComment(
          hidden._id,
          { body: null as unknown as string },
          activeCommenterId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lists paginated visible comments oldest first, excludes hidden ones, and resolves Deleted user and suspended author names', async () => {
      const missingCommenterId = new Types.ObjectId().toHexString();
      const post = await service.create(
        { title: 'Red Sea', body: 'Reef notes', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const draft = await service.create(
        { title: 'Draft', body: 'Secret', status: PostStatus.DRAFT },
        ownerId,
      );
      const hidden = await service.create(
        { title: 'Hidden', body: 'Mod', status: PostStatus.PUBLISHED },
        ownerId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden._id) },
        { $set: { isHidden: true } },
      );
      const raceDeactivated = await service.create(
        { title: 'Deactivated Race', body: 'B', status: PostStatus.PUBLISHED },
        deactivatedAuthorId,
      );

      const first = await service.createComment(
        post._id,
        { body: 'First chronological' },
        activeCommenterId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const second = await service.createComment(
        post._id,
        { body: 'Second by deactivated' },
        deactivatedCommenterId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const third = await service.createComment(
        post._id,
        { body: 'Third by suspended' },
        suspendedUserId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const fourth = await commentModel.create({
        postId: new Types.ObjectId(post._id),
        authorId: new Types.ObjectId(missingCommenterId),
        body: 'Fourth missing profile',
      });
      await commentModel.create({
        postId: new Types.ObjectId(post._id),
        authorId: new Types.ObjectId(activeCommenterId),
        body: 'Hidden moderation comment',
        isHidden: true,
      });

      const page1 = await service.listComments(post._id);
      expect(page1.page).toBe(1);
      expect(page1.limit).toBe(10);
      expect(page1.total).toBe(4);
      expect(page1.totalPages).toBe(1);
      expect(page1.items.map((c) => c._id)).toEqual([
        first._id,
        second._id,
        third._id,
        fourth._id.toHexString(),
      ]);
      expect(page1.items.map((c) => c.authorName)).toEqual([
        'Omar Said',
        'Deleted user',
        'Suspended Author',
        null,
      ]);

      for (const hiddenId of [
        draft._id,
        hidden._id,
        raceDeactivated._id,
        new Types.ObjectId().toHexString(),
      ]) {
        await expect(service.listComments(hiddenId)).rejects.toThrow(
          NotFoundException,
        );
      }
      await expect(service.listComments('bad-id')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('paginates comments with default limit 10 across pages ordered by createdAt then _id ascending', async () => {
      const post = await service.create(
        {
          title: 'Long Thread',
          body: 'Many comments',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      const postObjectId = new Types.ObjectId(post._id);
      const authorObjId = new Types.ObjectId(activeCommenterId);
      const baseTime = new Date('2026-11-16T10:00:00.000Z').getTime();

      // Insert 12 visible comments (comments #10 and #11 share createdAt to test _id tie-break across pages)
      // plus 1 hidden comment that must be excluded from items and total.
      const tieTime = new Date(baseTime + 90_000);
      const docs = [
        ...Array.from({ length: 9 }, (_, i) => ({
          _id: new Types.ObjectId(),
          postId: postObjectId,
          authorId: authorObjId,
          body: `Comment ${i + 1}`,
          isHidden: false,
          createdAt: new Date(baseTime + i * 10_000),
          updatedAt: new Date(baseTime + i * 10_000),
        })),
        {
          _id: new Types.ObjectId('673000000000000000000002'),
          postId: postObjectId,
          authorId: authorObjId,
          body: 'Comment 11 (tie _id higher)',
          isHidden: false,
          createdAt: tieTime,
          updatedAt: tieTime,
        },
        {
          _id: new Types.ObjectId('673000000000000000000001'),
          postId: postObjectId,
          authorId: authorObjId,
          body: 'Comment 10 (tie _id lower)',
          isHidden: false,
          createdAt: tieTime,
          updatedAt: tieTime,
        },
        {
          _id: new Types.ObjectId(),
          postId: postObjectId,
          authorId: authorObjId,
          body: 'Hidden comment',
          isHidden: true,
          createdAt: new Date(baseTime + 5_000),
          updatedAt: new Date(baseTime + 5_000),
        },
        {
          _id: new Types.ObjectId(),
          postId: postObjectId,
          authorId: authorObjId,
          body: 'Comment 12',
          isHidden: false,
          createdAt: new Date(baseTime + 100_000),
          updatedAt: new Date(baseTime + 100_000),
        },
      ];
      await commentModel.insertMany(docs);

      const page1 = await service.listComments(post._id);
      expect(page1.page).toBe(1);
      expect(page1.limit).toBe(10);
      expect(page1.total).toBe(12);
      expect(page1.totalPages).toBe(2);
      expect(page1.items).toHaveLength(10);
      expect(page1.items.map((c) => c.body)).toEqual([
        ...Array.from({ length: 9 }, (_, i) => `Comment ${i + 1}`),
        'Comment 10 (tie _id lower)',
      ]);

      const page2Query = new PaginationQueryDto();
      page2Query.page = 2;
      const page2 = await service.listComments(post._id, page2Query);
      expect(page2.page).toBe(2);
      expect(page2.limit).toBe(10);
      expect(page2.total).toBe(12);
      expect(page2.totalPages).toBe(2);
      expect(page2.items.map((c) => c.body)).toEqual([
        'Comment 11 (tie _id higher)',
        'Comment 12',
      ]);
    });

    it('updates own comment without changing commentCount and rejects non-owners or invalid input', async () => {
      const post = await service.create(
        { title: 'Luxor', body: 'Temples', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const comment = await service.createComment(
        post._id,
        { body: 'Initial comment' },
        activeCommenterId,
      );

      const updated = await service.updateComment(
        comment._id,
        { body: '  Updated comment  ' },
        activeCommenterId,
      );
      expect(updated.body).toBe('Updated comment');
      expect(updated.authorName).toBe('Omar Said');

      const postDoc = await postModel.findById(post._id).lean().exec();
      expect(postDoc?.commentCount).toBe(1);

      await expect(
        service.updateComment(comment._id, { body: 'Hijacked' }, otherUserId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateComment(
          new Types.ObjectId().toHexString(),
          { body: 'Missing' },
          activeCommenterId,
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateComment(comment._id, { body: '   ' }, activeCommenterId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateComment('bad-id', { body: 'Valid' }, activeCommenterId),
      ).rejects.toThrow(BadRequestException);
    });

    it('deletes own comment atomically, keeps commentCount accurate and non-negative, and rolls back on failure', async () => {
      const post = await service.create(
        { title: 'Aswan', body: 'Nile view', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const c1 = await service.createComment(
        post._id,
        { body: 'First' },
        activeCommenterId,
      );
      const c2 = await service.createComment(
        post._id,
        { body: 'Second' },
        otherUserId,
      );

      // Simulate an already-hidden comment (commentCount stays 2 even though hidden comment exists).
      const hiddenComment = await commentModel.create({
        postId: new Types.ObjectId(post._id),
        authorId: new Types.ObjectId(activeCommenterId),
        body: 'Hidden comment',
        isHidden: true,
      });

      // Non-owner cannot delete.
      await expect(service.deleteComment(c1._id, otherUserId)).rejects.toThrow(
        NotFoundException,
      );

      // Deleting hidden comment must NOT decrement visible commentCount.
      await service.deleteComment(
        hiddenComment._id.toHexString(),
        activeCommenterId,
      );
      expect(
        (await postModel.findById(post._id).lean().exec())?.commentCount,
      ).toBe(2);

      // Transaction rollback keeps comment intact if post commentCount update fails.
      const spy = vi.spyOn(postModel, 'updateOne').mockImplementationOnce(
        () =>
          ({
            exec: () => Promise.reject(new Error('count update failed')),
          }) as never,
      );
      await expect(
        service.deleteComment(c1._id, activeCommenterId),
      ).rejects.toThrow('count update failed');
      spy.mockRestore();
      expect(await commentModel.findById(c1._id).exec()).not.toBeNull();
      expect(
        (await postModel.findById(post._id).lean().exec())?.commentCount,
      ).toBe(2);

      // Deleting visible comments decrements accurately to 0.
      await service.deleteComment(c1._id, activeCommenterId);
      expect(
        (await postModel.findById(post._id).lean().exec())?.commentCount,
      ).toBe(1);
      await service.deleteComment(c2._id, otherUserId);
      expect(
        (await postModel.findById(post._id).lean().exec())?.commentCount,
      ).toBe(0);

      // Deleting a drifted visible comment when commentCount is already 0 keeps commentCount at 0.
      const driftedComment = await commentModel.create({
        postId: new Types.ObjectId(post._id),
        authorId: new Types.ObjectId(activeCommenterId),
        body: 'Drifted visible comment',
      });
      await service.deleteComment(
        driftedComment._id.toHexString(),
        activeCommenterId,
      );
      expect(
        (await postModel.findById(post._id).lean().exec())?.commentCount,
      ).toBe(0);

      // Repeated delete returns 404.
      await expect(
        service.deleteComment(c1._id, activeCommenterId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('likes (BLG-06)', () => {
    it('likes and unlikes a published post idempotently and updates likeCount accurately', async () => {
      const post = await service.create(
        {
          title: 'Likeable Post',
          body: 'Detailed guide to Luxor.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );

      // Unliking before any like is a no-op and never drives likeCount negative.
      const initialUnlike = await service.unlikePost(post._id, otherUserId);
      expect(initialUnlike).toEqual({
        postId: post._id,
        likeCount: 0,
        liked: false,
      });

      // First like creates the Like document and increments likeCount to 1.
      const liked = await service.likePost(post._id, otherUserId);
      expect(liked).toEqual({
        postId: post._id,
        likeCount: 1,
        liked: true,
      });
      expect(
        await likeModel.countDocuments({
          postId: new Types.ObjectId(post._id),
          userId: new Types.ObjectId(otherUserId),
        }),
      ).toBe(1);
      expect((await service.getById(post._id)).likeCount).toBe(1);

      // Repeated like by the same user is idempotent and does not double-increment.
      const doubleLiked = await service.likePost(post._id, otherUserId);
      expect(doubleLiked).toEqual({
        postId: post._id,
        likeCount: 1,
        liked: true,
      });
      expect(
        await likeModel.countDocuments({
          postId: new Types.ObjectId(post._id),
        }),
      ).toBe(1);
      expect((await service.getById(post._id)).likeCount).toBe(1);

      // Unlike removes the Like document and decrements likeCount back to 0.
      const unliked = await service.unlikePost(post._id, otherUserId);
      expect(unliked).toEqual({
        postId: post._id,
        likeCount: 0,
        liked: false,
      });
      expect(
        await likeModel.countDocuments({
          postId: new Types.ObjectId(post._id),
        }),
      ).toBe(0);
      expect((await service.getById(post._id)).likeCount).toBe(0);

      // Repeated unlike stays at 0 and never goes negative.
      const unlikedAgain = await service.unlikePost(post._id, otherUserId);
      expect(unlikedAgain).toEqual({
        postId: post._id,
        likeCount: 0,
        liked: false,
      });
      expect((await service.getById(post._id)).likeCount).toBe(0);
    });

    it('handles parallel likes from the same user and from different users without drifting likeCount', async () => {
      const post = await service.create(
        {
          title: 'Concurrent Likes Post',
          body: 'Stress test post.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );

      // Parallel likes from the SAME user must produce exactly 1 Like doc and likeCount === 1.
      const sameUserResults = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.likePost(post._id, otherUserId),
        ),
      );
      for (const res of sameUserResults) {
        expect(res.postId).toBe(post._id);
        expect(res.liked).toBe(true);
      }
      expect(
        await likeModel.countDocuments({
          postId: new Types.ObjectId(post._id),
          userId: new Types.ObjectId(otherUserId),
        }),
      ).toBe(1);
      expect((await service.getById(post._id)).likeCount).toBe(1);

      // Parallel likes from DIFFERENT users must increment likeCount once per distinct user.
      const distinctUsers = [
        ownerId,
        activeCommenterId,
        suspendedUserId,
        new Types.ObjectId().toHexString(),
      ];
      await Promise.all(
        distinctUsers.map((uid) => service.likePost(post._id, uid)),
      );
      expect(
        await likeModel.countDocuments({
          postId: new Types.ObjectId(post._id),
        }),
      ).toBe(5);
      expect((await service.getById(post._id)).likeCount).toBe(5);

      // Parallel unlikes from the SAME user must decrement only once (5 -> 4, never 0).
      await Promise.all(
        Array.from({ length: 4 }, () =>
          service.unlikePost(post._id, otherUserId),
        ),
      );
      expect(
        await likeModel.countDocuments({
          postId: new Types.ObjectId(post._id),
        }),
      ).toBe(4);
      expect((await service.getById(post._id)).likeCount).toBe(4);
    });

    it('rejects likes and unlikes on draft, hidden, deactivated-author, or missing posts and validates IDs', async () => {
      const draft = await service.create(
        { title: 'Draft', body: 'Hidden draft', status: PostStatus.DRAFT },
        ownerId,
      );
      const hidden = await service.create(
        { title: 'Hidden', body: 'Moderated', status: PostStatus.PUBLISHED },
        ownerId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden._id) },
        { $set: { isHidden: true } },
      );
      const deactivatedFlagged = await service.create(
        {
          title: 'Deactivated Flagged',
          body: 'Author deactivated flag',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(deactivatedFlagged._id) },
        { $set: { authorDeactivated: true } },
      );
      const deactivatedProfile = await service.create(
        {
          title: 'Deactivated Profile',
          body: 'Profile deactivated',
          status: PostStatus.PUBLISHED,
        },
        deactivatedAuthorId,
      );

      for (const blockedPostId of [
        draft._id,
        hidden._id,
        deactivatedFlagged._id,
        deactivatedProfile._id,
        new Types.ObjectId().toHexString(),
      ]) {
        await expect(
          service.likePost(blockedPostId, otherUserId),
        ).rejects.toThrow(NotFoundException);
        await expect(
          service.unlikePost(blockedPostId, otherUserId),
        ).rejects.toThrow(NotFoundException);
      }

      const invalidLikeErr = await service
        .likePost('not-an-object-id', otherUserId)
        .catch((err: unknown) => err);
      expect(invalidLikeErr).toBeInstanceOf(BadRequestException);
      expect(
        (invalidLikeErr as BadRequestException).getResponse(),
      ).toMatchObject({
        code: ErrorCode.ValidationFailed,
      });

      const invalidUserErr = await service
        .unlikePost(draft._id, 'bad-user-id')
        .catch((err: unknown) => err);
      expect(invalidUserErr).toBeInstanceOf(BadRequestException);
      expect(
        (invalidUserErr as BadRequestException).getResponse(),
      ).toMatchObject({
        code: ErrorCode.ValidationFailed,
      });
    });

    it('re-throws unexpected non-duplicate database errors during likePost', async () => {
      const post = await service.create(
        {
          title: 'DB Error Post',
          body: 'Testing unexpected create failure',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );

      vi.spyOn(likeModel, 'create').mockRejectedValueOnce(
        new Error('db failure'),
      );

      await expect(service.likePost(post._id, otherUserId)).rejects.toThrow(
        'db failure',
      );
      expect((await service.getById(post._id)).likeCount).toBe(0);
    });
  });

  describe('User deactivation & reactivation events (ACC-12)', () => {
    it('hides author posts on user.deactivated and restores published non-hidden posts on user.reactivated idempotently', async () => {
      const ownersPublished = await service.create(
        { title: 'Owner Pub', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const ownersDraft = await service.create(
        { title: 'Owner Draft', body: 'Draft', status: PostStatus.DRAFT },
        ownerId,
      );
      const ownersHidden = await service.create(
        { title: 'Owner Hidden', body: 'Hidden', status: PostStatus.PUBLISHED },
        ownerId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(ownersHidden._id) },
        { $set: { isHidden: true } },
      );
      const bystandersPublished = await service.create(
        { title: 'Other Pub', body: 'Other', status: PostStatus.PUBLISHED },
        otherUserId,
      );

      // Deliver via AppEvents (as production emitters do).
      appEvents.emit(Events.UserDeactivated, { userId: ownerId });
      await vi.waitFor(async () => {
        const updated = await postModel.findById(ownersPublished._id).lean();
        expect(updated?.authorDeactivated).toBe(true);
      });

      const listAfterDeactivate = await service.listPublished();
      expect(listAfterDeactivate.items.map((p) => p._id)).toEqual([
        bystandersPublished._id,
      ]);
      await expect(service.getById(ownersPublished._id)).rejects.toThrow(
        NotFoundException,
      );

      // Idempotent duplicate deactivation call keeps draft & all owner posts marked deactivated.
      await eventEmitter.emitAsync(Events.UserDeactivated, { userId: ownerId });
      const draftDoc = await postModel.findById(ownersDraft._id).lean();
      expect(draftDoc?.authorDeactivated).toBe(true);

      // Reactivation restores only the published, non-hidden post to public reads.
      await eventEmitter.emitAsync(Events.UserReactivated, { userId: ownerId });
      await eventEmitter.emitAsync(Events.UserReactivated, { userId: ownerId });

      const listAfterReactivate = await service.listPublished();
      expect(listAfterReactivate.items.map((p) => p._id)).toContain(
        ownersPublished._id,
      );
      expect(listAfterReactivate.items.map((p) => p._id)).not.toContain(
        ownersDraft._id,
      );
      expect(listAfterReactivate.items.map((p) => p._id)).not.toContain(
        ownersHidden._id,
      );

      const restored = await service.getById(ownersPublished._id);
      expect(restored._id).toBe(ownersPublished._id);
      expect(restored.authorName).toBe('Aisha Rawahi');
      expect(restored.authorDeactivated).toBe(false);

      // Draft and admin-hidden posts stay inaccessible on getById even after reactivation.
      await expect(service.getById(ownersDraft._id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getById(ownersHidden._id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('safely ignores invalid userId payloads in deactivation/reactivation events', async () => {
      const pub = await service.create(
        { title: 'Safe Post', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );

      await expect(
        eventEmitter.emitAsync(Events.UserDeactivated, { userId: 'bad-id' }),
      ).resolves.toBeDefined();
      await expect(
        eventEmitter.emitAsync(Events.UserReactivated, { userId: 'bad-id' }),
      ).resolves.toBeDefined();

      const persisted = await postModel.findById(pub._id).lean();
      expect(persisted?.authorDeactivated).toBe(false);
    });
  });
});
