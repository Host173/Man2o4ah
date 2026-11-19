import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { vi } from 'vitest';
import { FakeAccountsService } from '../../../test/fakes/accounts.fake.js';
import { FakeItinerariesService } from '../../../test/fakes/itineraries.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { Session } from '../accounts/schemas/session.schema.js';
import {
  ProviderType,
  User,
  UserRole,
  UserStatus,
} from '../accounts/schemas/user.schema.js';
import { ItinerariesService } from '../itineraries/itineraries.service.js';
import { Itinerary } from '../itineraries/schemas/itinerary.schema.js';
import { Airport } from '../reference-data/schemas/airport.schema.js';
import { Attraction } from '../reference-data/schemas/attraction.schema.js';
import { City } from '../reference-data/schemas/city.schema.js';
import { Country } from '../reference-data/schemas/country.schema.js';
import { Currency } from '../reference-data/schemas/currency.schema.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { StorageService } from '../storage/storage.service.js';
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
      .overrideProvider(getModelToken(Itinerary.name))
      .useValue({})
      // ItinerariesModule imports ReferenceDataModule (ITN-01).
      .overrideProvider(getModelToken(Country.name))
      .useValue({})
      .overrideProvider(getModelToken(City.name))
      .useValue({})
      .overrideProvider(getModelToken(Airport.name))
      .useValue({})
      .overrideProvider(getModelToken(Attraction.name))
      .useValue({})
      .overrideProvider(getModelToken(Currency.name))
      .useValue({})
      .compile();

    expect(moduleRef.get(BlogService)).toBeInstanceOf(BlogService);
  });
});

describe('BlogService (BLG-01, BLG-02, BLG-03, BLG-04, ACC-12 integration)', () => {
  let testApp: TestApp | undefined;
  let service: BlogService;
  const fakeAccounts = new FakeAccountsService();
  const fakeItineraries = new FakeItinerariesService();
  const fakeStorage = new FakeStorageService();
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
        builder
          .overrideProvider(AccountsService)
          .useValue(fakeAccounts)
          .overrideProvider(ItinerariesService)
          .useValue(fakeItineraries)
          .overrideProvider(StorageService)
          .useValue(fakeStorage),
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
    await Promise.all([
      postModel.init(),
      commentModel.init(),
      likeModel.init(),
    ]);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.restoreAllMocks();
    Object.assign(fakeItineraries, new FakeItinerariesService());
    Object.assign(fakeStorage, new FakeStorageService());
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
        {
          _id: imageId.toHexString(),
          key: 'blog/post-1.webp',
          url: '/uploads/blog/post-1.webp',
        },
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
        {
          _id: olderImageId.toHexString(),
          key: 'blog/cairo.jpg',
          url: '/uploads/blog/cairo.jpg',
        },
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
        images: [
          {
            _id: imageId.toHexString(),
            key: 'blog/reef.png',
            url: '/uploads/blog/reef.png',
          },
        ],
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

    it('preserves stored likeCount === like document count (0 or 1) across rounds of concurrent mixed likePost and unlikePost calls from the same user', async () => {
      const post = await service.create(
        {
          title: 'Mixed Race Post',
          body: 'Testing concurrent like/unlike interleaving from one user.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      const postObjectId = new Types.ObjectId(post._id);
      const userObjectId = new Types.ObjectId(otherUserId);

      for (let round = 0; round < 10; round += 1) {
        const calls = Array.from({ length: 20 }, (_, index) => {
          const isLike = (index + round) % 2 === 0;
          const delayMs = round % 2 === 0 ? 0 : index % 3;
          const invoke = () =>
            isLike
              ? service.likePost(post._id, otherUserId)
              : service.unlikePost(post._id, otherUserId);
          return delayMs === 0
            ? invoke()
            : new Promise((resolve) => setTimeout(resolve, delayMs)).then(
                invoke,
              );
        });

        const settled = await Promise.allSettled(calls);
        for (const outcome of settled) {
          expect(outcome.status).toBe('fulfilled');
          if (outcome.status === 'fulfilled') {
            expect(outcome.value.postId).toBe(post._id);
            expect(typeof outcome.value.liked).toBe('boolean');
            expect(outcome.value.likeCount).toBeGreaterThanOrEqual(0);
          }
        }

        const [storedPost, storedLikes] = await Promise.all([
          postModel.findById(postObjectId).lean().exec(),
          likeModel.countDocuments({
            postId: postObjectId,
            userId: userObjectId,
          }),
        ]);

        expect([0, 1]).toContain(storedLikes);
        expect(storedPost?.likeCount).toBe(storedLikes);
      }
    });

    it('cleans up newly inserted orphan like by _id if the post is deleted between visibility check and $inc (BLG-06)', async () => {
      const target = await service.create(
        {
          title: 'Target Post',
          body: 'Will be deleted mid-like.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      const bystander = await service.create(
        {
          title: 'Bystander Post',
          body: 'Existing like must stay intact.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      const normalPost = await service.create(
        {
          title: 'Normal Post',
          body: 'Control normal/idempotent like and prior-delete.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      const alreadyDeleted = await service.create(
        {
          title: 'Already Deleted Post',
          body: 'Deleted before likePost is invoked.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );

      const targetObjectId = new Types.ObjectId(target._id);
      const bystanderObjectId = new Types.ObjectId(bystander._id);
      const normalObjectId = new Types.ObjectId(normalPost._id);
      const alreadyDeletedObjectId = new Types.ObjectId(alreadyDeleted._id);
      const likerObjectId = new Types.ObjectId(otherUserId);

      // Normal like + idempotent double like on normalPost.
      const normalLike = await service.likePost(normalPost._id, otherUserId);
      expect(normalLike).toEqual({
        postId: normalPost._id,
        likeCount: 1,
        liked: true,
      });
      expect(
        await likeModel.countDocuments({ postId: normalObjectId }).exec(),
      ).toBe(1);
      expect((await service.getById(normalPost._id)).likeCount).toBe(1);

      const repeatNormalLike = await service.likePost(
        normalPost._id,
        otherUserId,
      );
      expect(repeatNormalLike).toEqual({
        postId: normalPost._id,
        likeCount: 1,
        liked: true,
      });
      expect(
        await likeModel.countDocuments({ postId: normalObjectId }).exec(),
      ).toBe(1);
      expect((await service.getById(normalPost._id)).likeCount).toBe(1);

      // Same user likes bystander post before the race; it must stay unaffected.
      await service.likePost(bystander._id, otherUserId);
      expect(
        await likeModel
          .countDocuments({
            postId: bystanderObjectId,
            userId: likerObjectId,
          })
          .exec(),
      ).toBe(1);

      // Liking an already-deleted post returns 404 NOT_FOUND with 0 likes.
      await postModel.deleteOne({ _id: alreadyDeletedObjectId }).exec();
      const preDeletedErr = await service
        .likePost(alreadyDeleted._id, otherUserId)
        .catch((err: unknown) => err);
      expect(preDeletedErr).toBeInstanceOf(NotFoundException);
      expect((preDeletedErr as NotFoundException).getStatus()).toBe(404);
      expect((preDeletedErr as NotFoundException).getResponse()).toMatchObject({
        code: ErrorCode.NotFound,
      });
      expect(
        await likeModel
          .countDocuments({ postId: alreadyDeletedObjectId })
          .exec(),
      ).toBe(0);

      // Deterministic race: delete target directly just before delegating to real likeModel.create.
      type CreateDoc = { postId: Types.ObjectId; userId: Types.ObjectId };
      const realCreate = likeModel.create.bind(likeModel) as (
        doc: CreateDoc,
      ) => Promise<LikeDocument>;
      const createSpy = vi
        .spyOn(likeModel, 'create')
        .mockImplementationOnce((async (doc: CreateDoc) => {
          await postModel.deleteOne({ _id: targetObjectId }).exec();
          return realCreate(doc);
        }) as never);

      let raceErr: unknown;
      try {
        raceErr = await service
          .likePost(target._id, otherUserId)
          .catch((err: unknown) => err);
      } finally {
        createSpy.mockRestore();
      }

      expect(raceErr).toBeInstanceOf(NotFoundException);
      expect((raceErr as NotFoundException).getStatus()).toBe(404);
      expect((raceErr as NotFoundException).getResponse()).toMatchObject({
        code: ErrorCode.NotFound,
      });
      expect(
        await likeModel.countDocuments({ postId: targetObjectId }).exec(),
      ).toBe(0);

      // Re-liking the now-deleted post after the race still returns 404 NOT_FOUND and 0 likes.
      const retryErr = await service
        .likePost(target._id, otherUserId)
        .catch((err: unknown) => err);
      expect(retryErr).toBeInstanceOf(NotFoundException);
      expect((retryErr as NotFoundException).getStatus()).toBe(404);
      expect((retryErr as NotFoundException).getResponse()).toMatchObject({
        code: ErrorCode.NotFound,
      });
      expect(
        await likeModel.countDocuments({ postId: targetObjectId }).exec(),
      ).toBe(0);

      // Bystander post's like by the same user remains intact.
      expect(
        await likeModel
          .countDocuments({
            postId: bystanderObjectId,
            userId: likerObjectId,
          })
          .exec(),
      ).toBe(1);
      expect((await service.getById(bystander._id)).likeCount).toBe(1);
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

  describe('tags & listByTag (BLG-08)', () => {
    it('attaches, normalises, deduplicates, and updates tags on create and update', async () => {
      const created = await service.create(
        {
          title: 'Siwa Notes',
          body: 'Salt lakes.',
          status: PostStatus.PUBLISHED,
          tags: ['Travel', ' travel ', 'TRAVEL', '  Egypt-2026  '],
        },
        ownerId,
      );
      expect(created.tags).toEqual(['travel', 'egypt-2026']);

      // Omitting tags in update leaves existing tags untouched.
      const titleOnly = await service.update(
        created._id,
        { title: 'Siwa Notes Edited' },
        ownerId,
      );
      expect(titleOnly.tags).toEqual(['travel', 'egypt-2026']);

      // Updating tags replaces and normalises them.
      const retagged = await service.update(
        created._id,
        { tags: ['  SIWA ', 'Oasis', 'siwa'] },
        ownerId,
      );
      expect(retagged.tags).toEqual(['siwa', 'oasis']);

      // Empty array clears tags.
      const cleared = await service.update(created._id, { tags: [] }, ownerId);
      expect(cleared.tags).toEqual([]);
    });

    it('rejects invalid tags on create and update with 400 VALIDATION_FAILED', async () => {
      const post = await service.create(
        { title: 'Base', body: 'Body', status: PostStatus.DRAFT },
        ownerId,
      );

      for (const badTags of [
        ['t1', 't2', 't3', 't4', 't5', 't6'],
        ['   '],
        [''],
        ['a'.repeat(31)],
        ['valid', 123] as unknown as string[],
        'not-an-array' as unknown as string[],
      ]) {
        const createErr = await service
          .create(
            {
              title: 'Invalid',
              body: 'Body',
              status: PostStatus.DRAFT,
              tags: badTags,
            },
            ownerId,
          )
          .catch((err: unknown) => err);
        expect(createErr).toBeInstanceOf(BadRequestException);
        expect((createErr as BadRequestException).getResponse()).toMatchObject({
          code: ErrorCode.ValidationFailed,
          details: [expect.objectContaining({ field: 'tags' })],
        });

        const updateErr = await service
          .update(post._id, { tags: badTags }, ownerId)
          .catch((err: unknown) => err);
        expect(updateErr).toBeInstanceOf(BadRequestException);
        expect((updateErr as BadRequestException).getResponse()).toMatchObject({
          code: ErrorCode.ValidationFailed,
          details: [expect.objectContaining({ field: 'tags' })],
        });
      }
    });

    it('lists paginated visible published posts by normalised tag and validates requested tag', async () => {
      const p1 = await service.create(
        {
          title: 'First Travel',
          body: 'One',
          status: PostStatus.PUBLISHED,
          tags: ['Travel', 'cairo'],
        },
        ownerId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p2 = await service.create(
        {
          title: 'Second Travel',
          body: 'Two',
          status: PostStatus.PUBLISHED,
          tags: ['  TRAVEL '],
        },
        suspendedUserId,
      );
      await service.create(
        {
          title: 'Draft Only',
          body: 'Three',
          status: PostStatus.DRAFT,
          tags: ['travel', 'draft-only'],
        },
        ownerId,
      );
      const hiddenPub = await service.create(
        {
          title: 'Hidden Pub',
          body: 'Four',
          status: PostStatus.PUBLISHED,
          tags: ['travel'],
        },
        ownerId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hiddenPub._id) },
        { $set: { isHidden: true } },
      );
      await service.create(
        {
          title: 'Deactivated Author Pub',
          body: 'Five',
          status: PostStatus.PUBLISHED,
          tags: ['travel'],
        },
        deactivatedAuthorId,
      );
      // Mark the deactivated author's post as deactivated to match ACC-12 event state.
      await eventEmitter.emitAsync(Events.UserDeactivated, {
        userId: deactivatedAuthorId,
      });

      const byUppercase = await service.listByTag('  TRAVEL ');
      expect(byUppercase.total).toBe(2);
      expect(byUppercase.items.map((p) => p._id)).toEqual([p2._id, p1._id]);
      expect(byUppercase.items[0].authorName).toBe('Suspended Author');
      expect(byUppercase.items[1].authorName).toBe('Aisha Rawahi');

      const draftOnly = await service.listByTag('DRAFT-ONLY');
      expect(draftOnly).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });

      const unknown = await service.listByTag('nonexistent');
      expect(unknown.items).toEqual([]);

      for (const invalidTag of ['', '   ', 'a'.repeat(31)]) {
        const err = await service
          .listByTag(invalidTag)
          .catch((caught: unknown) => caught);
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          code: ErrorCode.ValidationFailed,
          details: [expect.objectContaining({ field: 'tag' })],
        });
      }
    });
  });

  describe('getAuthorPage (BLG-12)', () => {
    it('returns author display name, join date, paginated visible published posts, and public itineraries without private fields', async () => {
      const joinDate = new Date('2026-10-05T08:30:00.000Z');
      Object.assign(
        fakeAccounts,
        new FakeAccountsService([
          {
            id: ownerId,
            name: 'Aisha Rawahi',
            email: 'aisha@example.com',
            createdAt: joinDate,
          },
          {
            id: otherUserId,
            name: 'Bob Nomad',
            email: 'bob@example.com',
          },
          {
            id: suspendedUserId,
            name: 'Suspended Author',
            email: 'suspended@example.com',
            status: UserStatus.SUSPENDED,
          },
        ]),
      );

      Object.assign(
        fakeItineraries,
        new FakeItinerariesService([
          {
            id: 'itin-1',
            ownerId,
            title: 'Upper Egypt Loop',
            countryCodes: ['EG'],
            startDate: new Date('2026-12-01T00:00:00.000Z'),
            dayCount: 5,
            cityIds: ['cairo', 'luxor'],
            updatedAt: new Date('2026-11-10T10:00:00.000Z'),
          },
          {
            id: 'itin-other',
            ownerId: otherUserId,
            title: 'Other User Trip',
            countryCodes: ['EG'],
            startDate: new Date('2026-12-15T00:00:00.000Z'),
            dayCount: 2,
            cityIds: ['aswan'],
            updatedAt: new Date('2026-11-12T10:00:00.000Z'),
          },
        ]),
      );

      const p1 = await service.create(
        {
          title: 'Older Published',
          body: 'One',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p2 = await service.create(
        {
          title: 'Newer Published',
          body: 'Two',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      await service.create(
        { title: 'Owner Draft', body: 'Secret', status: PostStatus.DRAFT },
        ownerId,
      );
      const hidden = await service.create(
        { title: 'Owner Hidden', body: 'Hidden', status: PostStatus.PUBLISHED },
        ownerId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden._id) },
        { $set: { isHidden: true } },
      );
      await service.create(
        { title: 'Other Author Post', body: 'O', status: PostStatus.PUBLISHED },
        otherUserId,
      );

      const page = await service.getAuthorPage(ownerId, { page: 1, limit: 1 });
      expect(page).toMatchObject({
        id: ownerId,
        name: 'Aisha Rawahi',
        createdAt: joinDate,
        posts: {
          page: 1,
          limit: 1,
          total: 2,
          totalPages: 2,
        },
        itineraries: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
        },
      });
      expect(page.posts.items.map((p) => p._id)).toEqual([p2._id]);
      expect(page.posts.items[0].authorName).toBe('Aisha Rawahi');
      expect(page.itineraries.items.map((i) => i.id)).toEqual(['itin-1']);
      expect(Object.keys(page).sort()).toEqual([
        'createdAt',
        'id',
        'itineraries',
        'name',
        'posts',
      ]);

      const page2 = await service.getAuthorPage(ownerId, { page: 2, limit: 1 });
      expect(page2.posts.items.map((p) => p._id)).toEqual([p1._id]);

      // Author with no posts or itineraries returns empty lists cleanly.
      const emptyAuthorPage = await service.getAuthorPage(suspendedUserId);
      expect(emptyAuthorPage).toMatchObject({
        id: suspendedUserId,
        name: 'Suspended Author',
        posts: { items: [], page: 1, limit: 10, total: 0, totalPages: 0 },
        itineraries: {
          items: [],
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
        },
      });
    });

    it('throws 404 NOT_FOUND for unknown or deactivated author and 400 for invalid id', async () => {
      for (const blockedId of [
        deactivatedAuthorId,
        new Types.ObjectId().toHexString(),
      ]) {
        const err = await service
          .getAuthorPage(blockedId)
          .catch((caught: unknown) => caught);
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as NotFoundException).getResponse()).toMatchObject({
          code: ErrorCode.NotFound,
        });
      }

      const badErr = await service
        .getAuthorPage('bad-id')
        .catch((caught: unknown) => caught);
      expect(badErr).toBeInstanceOf(BadRequestException);
      expect((badErr as BadRequestException).getResponse()).toMatchObject({
        code: ErrorCode.ValidationFailed,
      });
    });

    it('pages author itineraries independently of posts via itinerariesPage and itinerariesLimit (BLG-12)', async () => {
      const baseTime = new Date('2026-11-01T00:00:00.000Z').getTime();
      const seededItineraries = Array.from({ length: 25 }, (_, index) => ({
        id: `itin-${String(index + 1).padStart(2, '0')}`,
        ownerId,
        title: `Trip ${index + 1}`,
        countryCodes: ['EG'],
        startDate: new Date('2026-12-01T00:00:00.000Z'),
        dayCount: 3,
        cityIds: ['cairo'],
        // Newest updatedAt is itin-01, oldest is itin-25.
        updatedAt: new Date(baseTime + (25 - index) * 60_000),
      }));
      Object.assign(
        fakeItineraries,
        new FakeItinerariesService(seededItineraries),
      );

      const post1 = await service.create(
        { title: 'Post 1', body: 'One', status: PostStatus.PUBLISHED },
        ownerId,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const post2 = await service.create(
        { title: 'Post 2', body: 'Two', status: PostStatus.PUBLISHED },
        ownerId,
      );

      // Omitted parameters default both lists to page 1, limit 10.
      const defaultPage = await service.getAuthorPage(ownerId);
      expect(defaultPage.posts).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      expect(defaultPage.itineraries).toMatchObject({
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
      expect(defaultPage.itineraries.items).toHaveLength(10);

      // Page 1, 2, 3 cover all 25 itineraries cleanly without duplicates.
      const seenIds: string[] = [];
      for (const [pageNum, expectedCount] of [
        [1, 10],
        [2, 10],
        [3, 5],
      ] as const) {
        const res = await service.getAuthorPage(ownerId, {
          itinerariesPage: pageNum,
        });
        expect(res.itineraries).toMatchObject({
          page: pageNum,
          limit: 10,
          total: 25,
          totalPages: 3,
        });
        expect(res.itineraries.items).toHaveLength(expectedCount);
        seenIds.push(...res.itineraries.items.map((item) => item.id));
        // Posts remain on page 1 when only itinerariesPage changes.
        expect(res.posts.page).toBe(1);
        expect(res.posts.items.map((p) => p._id)).toEqual([
          post2._id,
          post1._id,
        ]);
      }
      expect(seenIds).toHaveLength(25);
      expect(new Set(seenIds).size).toBe(25);

      // Out-of-range itinerariesPage returns empty items cleanly.
      const pastEnd = await service.getAuthorPage(ownerId, {
        itinerariesPage: 4,
      });
      expect(pastEnd.itineraries).toEqual({
        items: [],
        page: 4,
        limit: 10,
        total: 25,
        totalPages: 3,
      });

      // itinerariesLimit=50 returns all 25 items in one page.
      const limit50 = await service.getAuthorPage(ownerId, {
        itinerariesLimit: 50,
      });
      expect(limit50.itineraries.limit).toBe(50);
      expect(limit50.itineraries.items).toHaveLength(25);

      // Moving posts page=2&limit=1 leaves itineraries on page 1 limit 10.
      const postsPage2 = await service.getAuthorPage(ownerId, {
        page: 2,
        limit: 1,
      });
      expect(postsPage2.posts.page).toBe(2);
      expect(postsPage2.posts.items.map((p) => p._id)).toEqual([post1._id]);
      expect(postsPage2.itineraries.page).toBe(1);
      expect(postsPage2.itineraries.limit).toBe(10);
      expect(postsPage2.itineraries.items).toHaveLength(10);
    });

    it('throws 404 NOT_FOUND for admin, airline_moderator, and hotel_moderator accounts even with content present (BLG-12)', async () => {
      const adminId = new Types.ObjectId().toHexString();
      const airlineModId = new Types.ObjectId().toHexString();
      const hotelModId = new Types.ObjectId().toHexString();

      Object.assign(
        fakeAccounts,
        new FakeAccountsService([
          {
            id: ownerId,
            name: 'Normal User',
            email: 'user@example.com',
            role: UserRole.USER,
          },
          {
            id: adminId,
            name: 'Platform Admin',
            email: 'admin@example.com',
            role: UserRole.ADMIN,
          },
          {
            id: airlineModId,
            name: 'Airline Moderator',
            email: 'airline-mod@example.com',
            role: UserRole.AIRLINE_MODERATOR,
            moderatorOf: {
              providerType: ProviderType.AIRLINE,
              providerId: new Types.ObjectId().toHexString(),
            },
          },
          {
            id: hotelModId,
            name: 'Hotel Moderator',
            email: 'hotel-mod@example.com',
            role: UserRole.HOTEL_MODERATOR,
            moderatorOf: {
              providerType: ProviderType.HOTEL,
              providerId: new Types.ObjectId().toHexString(),
            },
          },
        ]),
      );

      for (const accountId of [ownerId, adminId, airlineModId, hotelModId]) {
        await postModel.create({
          authorId: new Types.ObjectId(accountId),
          title: `Post by ${accountId}`,
          body: 'Sample post',
          status: PostStatus.PUBLISHED,
          publishedAt: new Date(),
        });
      }
      Object.assign(
        fakeItineraries,
        new FakeItinerariesService([
          {
            id: 'itin-user',
            ownerId,
            title: 'User Trip',
            countryCodes: ['EG'],
            startDate: new Date('2026-12-01T00:00:00.000Z'),
            dayCount: 2,
            cityIds: ['cairo'],
            updatedAt: new Date('2026-11-10T10:00:00.000Z'),
          },
          {
            id: 'itin-admin',
            ownerId: adminId,
            title: 'Admin Trip',
            countryCodes: ['EG'],
            startDate: new Date('2026-12-01T00:00:00.000Z'),
            dayCount: 2,
            cityIds: ['cairo'],
            updatedAt: new Date('2026-11-10T10:00:00.000Z'),
          },
          {
            id: 'itin-airline',
            ownerId: airlineModId,
            title: 'Airline Mod Trip',
            countryCodes: ['EG'],
            startDate: new Date('2026-12-01T00:00:00.000Z'),
            dayCount: 2,
            cityIds: ['cairo'],
            updatedAt: new Date('2026-11-10T10:00:00.000Z'),
          },
          {
            id: 'itin-hotel',
            ownerId: hotelModId,
            title: 'Hotel Mod Trip',
            countryCodes: ['EG'],
            startDate: new Date('2026-12-01T00:00:00.000Z'),
            dayCount: 2,
            cityIds: ['cairo'],
            updatedAt: new Date('2026-11-10T10:00:00.000Z'),
          },
        ]),
      );

      for (const nonUserId of [adminId, airlineModId, hotelModId]) {
        const err = await service
          .getAuthorPage(nonUserId)
          .catch((caught: unknown) => caught);
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as NotFoundException).getResponse()).toMatchObject({
          code: ErrorCode.NotFound,
        });
      }

      const userPage = await service.getAuthorPage(ownerId);
      expect(userPage.id).toBe(ownerId);
      expect(userPage.posts.items).toHaveLength(1);
      expect(userPage.itineraries.items).toHaveLength(1);
    });

    it('resolves role across multiple listAccounts pages when more than 50 accounts share a name prefix (BLG-12)', async () => {
      const targetAdminId = new Types.ObjectId().toHexString();
      const decoys = Array.from({ length: 55 }, (_, index) => ({
        id: new Types.ObjectId().toHexString(),
        name: `Traveler ${index + 1}`,
        email: `traveler-${index + 1}@example.com`,
        role: UserRole.USER,
        createdAt: new Date(Date.UTC(2026, 10, 2, 0, index + 1)),
      }));
      Object.assign(
        fakeAccounts,
        new FakeAccountsService([
          {
            id: targetAdminId,
            name: 'Traveler',
            email: 'admin-traveler@example.com',
            role: UserRole.ADMIN,
            createdAt: new Date('2026-11-01T00:00:00.000Z'),
          },
          ...decoys,
        ]),
      );

      const err = await service
        .getAuthorPage(targetAdminId)
        .catch((caught: unknown) => caught);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toMatchObject({
        code: ErrorCode.NotFound,
      });
    });
  });

  describe('search via listPublished (BLG-09)', () => {
    it('orders search results by interaction score (likes + comments) descending then publishedAt descending and updates ordering on new engagement', async () => {
      const oldestMs = new Date('2026-11-10T10:00:00.000Z').getTime();

      const lowScoreNewer = await service.create(
        {
          title: 'Desert Safari Guide A',
          body: 'Dunes and oasis camp.',
          status: PostStatus.PUBLISHED,
          tags: ['desert'],
        },
        ownerId,
      );
      const tieOlder = await service.create(
        {
          title: 'Desert Safari Guide B',
          body: 'Camel trek and sunset.',
          status: PostStatus.PUBLISHED,
          tags: ['desert'],
        },
        ownerId,
      );
      const tieNewer = await service.create(
        {
          title: 'Desert Safari Guide C',
          body: 'Stargazing in White Desert.',
          status: PostStatus.PUBLISHED,
          tags: ['desert'],
        },
        otherUserId,
      );
      const highestScore = await service.create(
        {
          title: 'Desert Safari Guide D',
          body: 'Full 4x4 route map and tips.',
          status: PostStatus.PUBLISHED,
          tags: ['desert'],
        },
        otherUserId,
      );

      // Excluded visibility posts sharing the keyword.
      await service.create(
        {
          title: 'Desert Draft',
          body: 'Unpublished.',
          status: PostStatus.DRAFT,
          tags: ['desert'],
        },
        ownerId,
      );
      const hidden = await service.create(
        {
          title: 'Desert Hidden',
          body: 'Moderated.',
          status: PostStatus.PUBLISHED,
          tags: ['desert'],
        },
        ownerId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden._id) },
        { $set: { isHidden: true } },
      );

      await Promise.all([
        postModel.updateOne(
          { _id: new Types.ObjectId(lowScoreNewer._id) },
          {
            $set: {
              likeCount: 1,
              commentCount: 0,
              publishedAt: new Date(oldestMs + 40_000),
            },
          },
        ),
        postModel.updateOne(
          { _id: new Types.ObjectId(tieOlder._id) },
          {
            $set: {
              likeCount: 2,
              commentCount: 1,
              publishedAt: new Date(oldestMs + 20_000),
            },
          },
        ),
        postModel.updateOne(
          { _id: new Types.ObjectId(tieNewer._id) },
          {
            $set: {
              likeCount: 1,
              commentCount: 2,
              publishedAt: new Date(oldestMs + 30_000),
            },
          },
        ),
        postModel.updateOne(
          { _id: new Types.ObjectId(highestScore._id) },
          {
            $set: {
              likeCount: 4,
              commentCount: 1,
              publishedAt: new Date(oldestMs + 10_000),
            },
          },
        ),
      ]);

      // Expect scores: highestScore (5) > tieNewer (3, newer date) > tieOlder (3, older date) > lowScoreNewer (1).
      const page1 = await service.listPublished({
        q: '  safari ',
        page: 1,
        limit: 2,
      });
      expect(page1.total).toBe(4);
      expect(page1.totalPages).toBe(2);
      expect(page1.items.map((p) => p._id)).toEqual([
        highestScore._id,
        tieNewer._id,
      ]);
      expect(page1.items[0].excerpt).toBe('Full 4x4 route map and tips.');

      const page2 = await service.listPublished({
        q: 'SAFARI',
        page: 2,
        limit: 2,
      });
      expect(page2.items.map((p) => p._id)).toEqual([
        tieOlder._id,
        lowScoreNewer._id,
      ]);

      // Adding comments + likes on lowScoreNewer pushes it above highestScore (1 -> 7).
      await service.createComment(
        lowScoreNewer._id,
        { body: 'Comment 1' },
        activeCommenterId,
      );
      await service.createComment(
        lowScoreNewer._id,
        { body: 'Comment 2' },
        otherUserId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(lowScoreNewer._id) },
        { $inc: { likeCount: 4 } },
      );

      const reordered = await service.listPublished({
        q: 'safari',
        page: 1,
        limit: 4,
      });
      expect(reordered.items.map((p) => p._id)).toEqual([
        lowScoreNewer._id,
        highestScore._id,
        tieNewer._id,
        tieOlder._id,
      ]);
    });

    it('matches title, normalised tag, and active/suspended author name safely with special characters and rejects overlong q', async () => {
      const longBody = `<h1>Heading</h1><p>${'A'.repeat(220)}</p>`;
      const titleMatch = await service.create(
        {
          title: 'Hiking in C++ (South) Canyon',
          body: longBody,
          status: PostStatus.PUBLISHED,
          tags: ['trekking'],
        },
        ownerId,
      );
      const tagMatch = await service.create(
        {
          title: 'Coastal Notes',
          body: 'Beaches',
          status: PostStatus.PUBLISHED,
          tags: ['  Egypt-2026  '],
        },
        ownerId,
      );
      const suspendedAuthorMatch = await service.create(
        {
          title: 'Nomad Journal',
          body: 'Journal entry.',
          status: PostStatus.PUBLISHED,
        },
        suspendedUserId,
      );
      const deactivatedPost = await service.create(
        {
          title: 'Deactivated Author C++ Post',
          body: 'Hidden author.',
          status: PostStatus.PUBLISHED,
        },
        deactivatedAuthorId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(deactivatedPost._id) },
        { $set: { authorDeactivated: true } },
      );

      // Special regex characters in q must match literally without throwing.
      const regexSafe = await service.listPublished({
        page: 1,
        limit: 10,
        q: 'C++ (South)',
      });
      expect(regexSafe.items.map((p) => p._id)).toEqual([titleMatch._id]);
      expect(regexSafe.items[0].excerpt).toBe(`Heading ${'A'.repeat(192)}...`);

      // Tag partial match via q.
      const byTagQuery = await service.listPublished({
        page: 1,
        limit: 10,
        q: '  EGYPT-20 ',
      });
      expect(byTagQuery.items.map((p) => p._id)).toEqual([tagMatch._id]);

      // Author name match via FakeAccountsService.findUserIdsByName (suspended shown, deactivated excluded).
      const byAuthor = await service.listPublished({
        page: 1,
        limit: 10,
        q: 'suspended',
      });
      expect(byAuthor.items.map((p) => p._id)).toEqual([
        suspendedAuthorMatch._id,
      ]);
      expect(byAuthor.items[0].authorName).toBe('Suspended Author');

      const byDeactivatedAuthor = await service.listPublished({
        page: 1,
        limit: 10,
        q: 'Deactivated Author',
      });
      expect(byDeactivatedAuthor.items).toEqual([]);

      // Blank q acts as unfiltered browse; 150 emoji (300 UTF-16 units) are accepted cleanly.
      const blankQ = await service.listPublished({
        page: 1,
        limit: 10,
        q: '   ',
      });
      expect(blankQ.total).toBe(3);

      const emojiSearch = await service.listPublished({
        page: 1,
        limit: 10,
        q: '😀'.repeat(150),
      });
      expect(emojiSearch).toMatchObject({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('post images (BLG-10)', () => {
    const sampleImage = (
      name = 'photo.png',
      mimetype = 'image/png',
    ): UploadedImage => {
      const buffer = Buffer.from(`bytes-for-${name}`);
      return {
        buffer,
        originalname: name,
        mimetype,
        size: buffer.length,
      };
    };

    it('attaches up to 5 images, stores ImageRef only in DB, computes url, and rejects a 6th with LIMIT_EXCEEDED', async () => {
      const post = await service.create(
        {
          title: 'Siwa Sunset',
          body: 'Dunes in golden hour.',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );

      const first = await service.addImage(
        post._id,
        sampleImage('one.jpg', 'image/jpeg'),
        ownerId,
      );
      expect(first.images).toHaveLength(1);
      expect(first.images[0]).toEqual({
        _id: expect.stringMatching(/^[0-9a-f]{24}$/),
        key: expect.stringMatching(/^[0-9a-f]{24}\.jpg$/),
        url: `/uploads/${first.images[0]!.key}`,
      });
      expect(fakeStorage.has(first.images[0]!.key)).toBe(true);

      const stored = await postModel.findById(post._id).lean().exec();
      expect(stored?.images).toHaveLength(1);
      expect(stored?.images[0]).toMatchObject({ key: first.images[0]!.key });
      expect('url' in (stored?.images[0] ?? {})).toBe(false);

      let latest = first;
      for (let i = 2; i <= 5; i += 1) {
        latest = await service.addImage(
          post._id,
          sampleImage(`img-${i}.png`),
          ownerId,
        );
      }
      expect(latest.images).toHaveLength(5);
      expect(fakeStorage.keys()).toHaveLength(5);

      await expect(
        service.addImage(post._id, sampleImage('sixth.png'), ownerId),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: { code: ErrorCode.LimitExceeded },
      });

      const afterRejected = await postModel.findById(post._id).lean().exec();
      expect(afterRejected?.images).toHaveLength(5);
      expect(fakeStorage.keys()).toHaveLength(5);
    });

    it('removes an image, leaves empty array after last removal, and allows attaching again', async () => {
      const post = await service.create(
        { title: 'Gallery', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );

      let latest = post;
      for (let i = 1; i <= 5; i += 1) {
        latest = await service.addImage(
          post._id,
          sampleImage(`pic-${i}.png`),
          ownerId,
        );
      }
      const removedImg = latest.images[2]!;

      await service.removeImage(post._id, removedImg._id, ownerId);
      expect(fakeStorage.has(removedImg.key)).toBe(false);
      expect(fakeStorage.keys()).toHaveLength(4);

      const afterRemove = await service.getById(post._id);
      expect(afterRemove.images).toHaveLength(4);
      expect(afterRemove.images.map((img) => img._id)).not.toContain(
        removedImg._id,
      );

      const replaced = await service.addImage(
        post._id,
        sampleImage('replacement.jpg', 'image/jpeg'),
        ownerId,
      );
      expect(replaced.images).toHaveLength(5);
      expect(fakeStorage.keys()).toHaveLength(5);

      for (const img of replaced.images) {
        await service.removeImage(post._id, img._id, ownerId);
      }
      const emptied = await postModel.findById(post._id).lean().exec();
      expect(emptied?.images).toEqual([]);
      expect(fakeStorage.keys()).toEqual([]);
    });

    it('supports attaching and removing images on own draft and hidden posts', async () => {
      const draft = await service.create(
        { title: 'Draft Post', body: 'Body', status: PostStatus.DRAFT },
        ownerId,
      );
      const hidden = await service.create(
        { title: 'Hidden Post', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden._id) },
        { $set: { isHidden: true } },
      );

      const draftUpdated = await service.addImage(
        draft._id,
        sampleImage('draft.png'),
        ownerId,
      );
      expect(draftUpdated.images).toHaveLength(1);
      await service.removeImage(
        draft._id,
        draftUpdated.images[0]!._id,
        ownerId,
      );
      expect(fakeStorage.has(draftUpdated.images[0]!.key)).toBe(false);

      const hiddenUpdated = await service.addImage(
        hidden._id,
        sampleImage('hidden.png'),
        ownerId,
      );
      expect(hiddenUpdated.images).toHaveLength(1);
      await service.removeImage(
        hidden._id,
        hiddenUpdated.images[0]!._id,
        ownerId,
      );
      expect(fakeStorage.has(hiddenUpdated.images[0]!.key)).toBe(false);
    });

    it('rejects unknown imageId, another post imageId, repeated delete, missing post, non-owner, and malformed ids', async () => {
      const postA = await service.create(
        { title: 'Post A', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const postB = await service.create(
        { title: 'Post B', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      const withImgB = await service.addImage(
        postB._id,
        sampleImage('b.png'),
        ownerId,
      );
      const imgB = withImgB.images[0]!;

      await expect(
        service.removeImage(
          postA._id,
          new Types.ObjectId().toHexString(),
          ownerId,
        ),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.removeImage(postA._id, imgB._id, ownerId),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.addImage(postA._id, sampleImage('intruder.png'), otherUserId),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.removeImage(postB._id, imgB._id, otherUserId),
      ).rejects.toThrow(NotFoundException);

      const missingPostId = new Types.ObjectId().toHexString();
      await expect(
        service.addImage(missingPostId, sampleImage('missing.png'), ownerId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.removeImage(missingPostId, imgB._id, ownerId),
      ).rejects.toThrow(NotFoundException);

      // Malformed IDs and missing file return 400 VALIDATION_FAILED.
      await expect(
        service.addImage('bad-id', sampleImage('m.png'), ownerId),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'postId' }],
        },
      });
      await expect(
        service.removeImage('bad-id', imgB._id, ownerId),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'postId' }],
        },
      });
      await expect(
        service.removeImage(postB._id, 'bad-image-id', ownerId),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'imageId' }],
        },
      });
      await expect(
        service.addImage(postA._id, undefined, ownerId),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'file' }],
        },
      });

      // Repeated delete fails with NOT_FOUND and does not touch other posts' files.
      await service.removeImage(postB._id, imgB._id, ownerId);
      await expect(
        service.removeImage(postB._id, imgB._id, ownerId),
      ).rejects.toThrow(NotFoundException);
      expect(fakeStorage.keys()).toEqual([]);
    });

    it('enforces the 5-image limit atomically across parallel uploads without leaving orphan files', async () => {
      const post = await service.create(
        { title: 'Concurrent', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );
      for (let i = 1; i <= 3; i += 1) {
        await service.addImage(post._id, sampleImage(`seed-${i}.png`), ownerId);
      }

      const settled = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) =>
          service.addImage(post._id, sampleImage(`parallel-${i}.png`), ownerId),
        ),
      );

      const fulfilled = settled.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof service.addImage>>
        > => result.status === 'fulfilled',
      );
      const rejected = settled.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(3);
      for (const rej of rejected) {
        expect(rej.reason).toBeInstanceOf(BadRequestException);
        expect((rej.reason as BadRequestException).getResponse()).toMatchObject(
          { code: ErrorCode.LimitExceeded },
        );
      }

      const finalDoc = await postModel.findById(post._id).lean().exec();
      expect(finalDoc?.images).toHaveLength(5);
      const storedKeys = (finalDoc?.images ?? []).map((img) => img.key);
      expect(new Set(fakeStorage.keys())).toEqual(new Set(storedKeys));
      expect(fakeStorage.keys()).toHaveLength(5);
    });

    it('propagates StorageService failures cleanly and cleans up newly saved files on post-save DB errors or deletion races', async () => {
      const post = await service.create(
        {
          title: 'Failure Cleanup',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      const initial = await service.addImage(
        post._id,
        sampleImage('initial.png'),
        ownerId,
      );

      vi.spyOn(fakeStorage, 'save').mockRejectedValueOnce(
        new BadRequestException({
          code: ErrorCode.ValidationFailed,
          message: 'Invalid image',
          details: [
            { field: 'file', message: 'only JPG or PNG images are allowed' },
          ],
        }),
      );

      await expect(
        service.addImage(
          post._id,
          sampleImage('bad.gif', 'image/gif'),
          ownerId,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: { code: ErrorCode.ValidationFailed },
      });
      expect(fakeStorage.keys()).toEqual([initial.images[0]!.key]);

      // DB write fails after storage.save: newly saved file is deleted.
      vi.spyOn(postModel, 'findOneAndUpdate').mockReturnValueOnce({
        lean: () => ({
          exec: () => Promise.reject(new Error('db write failure')),
        }),
      } as never);
      await expect(
        service.addImage(post._id, sampleImage('db-fail.png'), ownerId),
      ).rejects.toThrow('db write failure');
      expect(fakeStorage.keys()).toEqual([initial.images[0]!.key]);

      // Post is deleted while file is being saved: newly saved file is deleted and 404 is thrown.
      const realSave = fakeStorage.save.bind(fakeStorage);
      vi.spyOn(fakeStorage, 'save').mockImplementationOnce(async (file) => {
        await postModel.deleteOne({ _id: new Types.ObjectId(post._id) }).exec();
        return realSave(file);
      });
      await expect(
        service.addImage(post._id, sampleImage('race-del.png'), ownerId),
      ).rejects.toThrow(NotFoundException);
      expect(fakeStorage.keys()).toEqual([initial.images[0]!.key]);
    });

    it('deletes all post image files when the post is deleted, and preserves them if the delete transaction rolls back', async () => {
      const target = await service.create(
        {
          title: 'Delete With Images',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      const bystander = await service.create(
        { title: 'Keep Images', body: 'Body', status: PostStatus.PUBLISHED },
        ownerId,
      );

      await service.addImage(target._id, sampleImage('t1.png'), ownerId);
      const targetWithImgs = await service.addImage(
        target._id,
        sampleImage('t2.jpg', 'image/jpeg'),
        ownerId,
      );
      const bystanderWithImg = await service.addImage(
        bystander._id,
        sampleImage('keep.png'),
        ownerId,
      );

      // Rollback preserves files.
      const deleteLikesSpy = vi
        .spyOn(likeModel, 'deleteMany')
        .mockImplementationOnce(
          () =>
            ({
              exec: () => Promise.reject(new Error('rollback delete')),
            }) as never,
        );
      await expect(service.delete(target._id, ownerId)).rejects.toThrow(
        'rollback delete',
      );
      deleteLikesSpy.mockRestore();
      for (const img of targetWithImgs.images) {
        expect(fakeStorage.has(img.key)).toBe(true);
      }

      // Successful post deletion removes all target files and keeps bystander's file.
      await service.delete(target._id, ownerId);
      for (const img of targetWithImgs.images) {
        expect(fakeStorage.has(img.key)).toBe(false);
      }
      expect(fakeStorage.has(bystanderWithImg.images[0]!.key)).toBe(true);
      expect(fakeStorage.keys()).toEqual([bystanderWithImg.images[0]!.key]);
    });

    it('persists failed image cleanup during post delete while still attempting every file', async () => {
      const post = await service.create(
        {
          title: 'Partial Storage Delete Failure',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      await service.addImage(post._id, sampleImage('p1.png'), ownerId);
      await service.addImage(
        post._id,
        sampleImage('p2.jpg', 'image/jpeg'),
        ownerId,
      );
      const postWithImages = await service.addImage(
        post._id,
        sampleImage('p3.png'),
        ownerId,
      );
      const [img1, img2, img3] = postWithImages.images;
      expect(img1 && img2 && img3).toBeTruthy();

      const realDelete = fakeStorage.delete.bind(fakeStorage);
      const deleteSpy = vi
        .spyOn(fakeStorage, 'delete')
        .mockImplementation(async (key) => {
          if (key === img1!.key) {
            throw new Error('storage unlink failure');
          }
          return realDelete(key);
        });

      await expect(service.delete(post._id, ownerId)).resolves.toBeUndefined();

      expect(deleteSpy).toHaveBeenCalledTimes(3);
      expect(deleteSpy).toHaveBeenCalledWith(img1!.key);
      expect(deleteSpy).toHaveBeenCalledWith(img2!.key);
      expect(deleteSpy).toHaveBeenCalledWith(img3!.key);
      expect(fakeStorage.has(img1!.key)).toBe(true);
      expect(fakeStorage.has(img2!.key)).toBe(false);
      expect(fakeStorage.has(img3!.key)).toBe(false);
      expect(await postModel.findById(post._id).lean().exec()).toBeNull();
      const pending = await testApp!.connection
        .collection<{ postId: Types.ObjectId; key: string }>(
          'post_image_cleanups',
        )
        .find({ postId: new Types.ObjectId(post._id) })
        .toArray();
      expect(pending.map((item) => item.key)).toEqual([img1!.key]);
    });

    it('keeps the image reference in removeImage when storage.delete fails and succeeds cleanly on retry', async () => {
      const post = await service.create(
        {
          title: 'Remove Image Storage Failure',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        },
        ownerId,
      );
      await service.addImage(post._id, sampleImage('keep-1.png'), ownerId);
      const updated = await service.addImage(
        post._id,
        sampleImage('keep-2.png'),
        ownerId,
      );
      const [img1, img2] = updated.images;
      expect(img1 && img2).toBeTruthy();

      const deleteSpy = vi
        .spyOn(fakeStorage, 'delete')
        .mockRejectedValueOnce(new Error('disk busy'));

      await expect(
        service.removeImage(post._id, img1!._id, ownerId),
      ).rejects.toThrow('disk busy');
      expect(deleteSpy).toHaveBeenCalledWith(img1!.key);

      // Reference and stored file remain intact when file deletion fails.
      const afterFailedRemoveDoc = await postModel
        .findById(post._id)
        .lean()
        .exec();
      expect(afterFailedRemoveDoc?.images.map((item) => item.key)).toEqual([
        img1!.key,
        img2!.key,
      ]);
      const afterFailedRemoveView = await service.getById(post._id);
      expect(afterFailedRemoveView.images.map((item) => item._id)).toEqual([
        img1!._id,
        img2!._id,
      ]);
      expect(fakeStorage.has(img1!.key)).toBe(true);
      expect(fakeStorage.has(img2!.key)).toBe(true);

      // Retrying once storage recovers removes both file and reference.
      await expect(
        service.removeImage(post._id, img1!._id, ownerId),
      ).resolves.toBeUndefined();
      const afterRetryDoc = await postModel.findById(post._id).lean().exec();
      expect(afterRetryDoc?.images.map((item) => item.key)).toEqual([
        img2!.key,
      ]);
      const afterRetryView = await service.getById(post._id);
      expect(afterRetryView.images.map((item) => item._id)).toEqual([
        img2!._id,
      ]);
      expect(fakeStorage.has(img1!.key)).toBe(false);
      expect(fakeStorage.has(img2!.key)).toBe(true);
    });
  });
});
