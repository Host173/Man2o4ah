import { EventEmitter2 } from '@nestjs/event-emitter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { FakeAccountsService } from '../../../test/fakes/accounts.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Events } from '../../common/events/events.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { UserRole, UserStatus } from '../accounts/schemas/user.schema.js';
import { BlogModule } from './blog.module.js';
import { Comment, type CommentDocument } from './schemas/comment.schema.js';
import { Like, type LikeDocument } from './schemas/like.schema.js';
import { Post, PostStatus, type PostDocument } from './schemas/post.schema.js';

describe('BlogController HTTP API (BLG-01, BLG-02, BLG-03, BLG-04)', () => {
  let testApp: TestApp | undefined;
  const fakeAccounts = new FakeAccountsService();
  let eventEmitter: EventEmitter2;
  let postModel: Model<PostDocument>;
  let commentModel: Model<CommentDocument>;
  let likeModel: Model<LikeDocument>;

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [BlogModule],
      override: (builder) =>
        builder.overrideProvider(AccountsService).useValue(fakeAccounts),
    });
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
    Object.assign(fakeAccounts, new FakeAccountsService());
    if (testApp) {
      await clearCollections(testApp.connection);
    }
  });

  afterAll(async () => {
    await testApp?.close();
  }, HOOK_TIMEOUT);

  it('registers Swagger paths and schemas for blog endpoints', () => {
    const document = SwaggerModule.createDocument(
      testApp!.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .build(),
    );

    expect(document.paths['/api/posts']?.post).toBeDefined();
    expect(document.paths['/api/posts']?.get).toBeDefined();
    expect(document.paths['/api/posts']?.get?.security).toBeUndefined();
    expect(document.paths['/api/posts/mine']?.get).toBeDefined();
    expect(document.paths['/api/posts/{id}']?.get).toBeDefined();
    expect(document.paths['/api/posts/{id}']?.get?.security).toBeUndefined();
    expect(document.paths['/api/posts/{id}']?.patch).toBeDefined();
    expect(document.paths['/api/posts/{id}']?.delete).toBeDefined();
    expect(document.paths['/api/posts/{id}/comments']?.get).toBeDefined();
    expect(
      document.paths['/api/posts/{id}/comments']?.get?.security,
    ).toBeUndefined();
    expect(document.paths['/api/posts/{id}/comments']?.post).toBeDefined();
    expect(document.paths['/api/comments/{id}']?.patch).toBeDefined();
    expect(document.paths['/api/comments/{id}']?.delete).toBeDefined();
    expect(document.paths['/api/tags/{tag}/posts']?.get).toBeDefined();
    expect(
      document.paths['/api/tags/{tag}/posts']?.get?.security,
    ).toBeUndefined();
  });

  describe('Authentication & password-change gate', () => {
    it('rejects unauthenticated requests across all blog endpoints with 401 NOT_AUTHENTICATED', async () => {
      const someId = new Types.ObjectId().toHexString();

      const createRes = await testApp!
        .http()
        .post('/api/posts')
        .send({ title: 'Hello', body: 'World', status: PostStatus.DRAFT });
      expect(createRes.status).toBe(401);
      expect(createRes.body).toMatchObject({
        statusCode: 401,
        code: ErrorCode.NotAuthenticated,
        path: '/api/posts',
      });

      const listRes = await testApp!.http().get('/api/posts/mine');
      expect(listRes.status).toBe(401);
      expect(listRes.body).toMatchObject({
        statusCode: 401,
        code: ErrorCode.NotAuthenticated,
        path: '/api/posts/mine',
      });

      const patchRes = await testApp!
        .http()
        .patch(`/api/posts/${someId}`)
        .send({ title: 'Updated' });
      expect(patchRes.status).toBe(401);
      expect(patchRes.body.code).toBe(ErrorCode.NotAuthenticated);

      const deleteRes = await testApp!.http().delete(`/api/posts/${someId}`);
      expect(deleteRes.status).toBe(401);
      expect(deleteRes.body.code).toBe(ErrorCode.NotAuthenticated);

      const createCommentRes = await testApp!
        .http()
        .post(`/api/posts/${someId}/comments`)
        .send({ body: 'Guest comment' });
      expect(createCommentRes.status).toBe(401);
      expect(createCommentRes.body.code).toBe(ErrorCode.NotAuthenticated);

      const patchCommentRes = await testApp!
        .http()
        .patch(`/api/comments/${someId}`)
        .send({ body: 'Updated comment' });
      expect(patchCommentRes.status).toBe(401);
      expect(patchCommentRes.body.code).toBe(ErrorCode.NotAuthenticated);

      const deleteCommentRes = await testApp!
        .http()
        .delete(`/api/comments/${someId}`);
      expect(deleteCommentRes.status).toBe(401);
      expect(deleteCommentRes.body.code).toBe(ErrorCode.NotAuthenticated);
    });

    it('rejects expired sessions with 401 and mustChangePassword users with 403 PASSWORD_CHANGE_REQUIRED', async () => {
      const expired = await loginAs(testApp!.connection, UserRole.USER, {
        sessionExpired: true,
      });
      const expiredRes = await testApp!
        .http()
        .get('/api/posts/mine')
        .set('Cookie', expired.cookie);
      expect(expiredRes.status).toBe(401);
      expect(expiredRes.body.code).toBe(ErrorCode.SessionExpired);

      const mustChange = await loginAs(testApp!.connection, UserRole.USER, {
        mustChangePassword: true,
      });
      const gatedRes = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', mustChange.cookie)
        .send({ title: 'Blocked', body: 'Body', status: PostStatus.DRAFT });
      expect(gatedRes.status).toBe(403);
      expect(gatedRes.body.code).toBe(ErrorCode.PasswordChangeRequired);
    });
  });

  describe('POST /api/posts (BLG-01)', () => {
    it('creates a draft post and a published post for the authenticated user', async () => {
      const user = await loginAs(testApp!.connection, UserRole.USER);

      const draftRes = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', user.cookie)
        .send({
          title: '  Sinai Trail Draft  ',
          body: '  Packing checklist for Dahab.  ',
          status: PostStatus.DRAFT,
        });

      expect(draftRes.status).toBe(201);
      expect(draftRes.body).toMatchObject({
        authorId: user.id,
        title: 'Sinai Trail Draft',
        body: '  Packing checklist for Dahab.  ',
        status: PostStatus.DRAFT,
        tags: [],
        images: [],
        likeCount: 0,
        commentCount: 0,
        isHidden: false,
        authorDeactivated: false,
      });
      expect(draftRes.body._id).toMatch(/^[0-9a-f]{24}$/);
      expect(draftRes.body.publishedAt).toBeUndefined();

      const pubRes = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', user.cookie)
        .send({
          title: 'Siwa Oasis',
          body: 'Salt lakes and desert springs.',
          status: PostStatus.PUBLISHED,
        });

      expect(pubRes.status).toBe(201);
      expect(pubRes.body.status).toBe(PostStatus.PUBLISHED);
      expect(typeof pubRes.body.publishedAt).toBe('string');
      expect(Number.isNaN(Date.parse(pubRes.body.publishedAt as string))).toBe(
        false,
      );
    });

    it('returns 400 VALIDATION_FAILED for invalid payloads or disallowed server-managed fields', async () => {
      const user = await loginAs(testApp!.connection, UserRole.USER);

      const whitespaceTitle = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', user.cookie)
        .send({ title: '   ', body: 'Valid body', status: PostStatus.DRAFT });
      expect(whitespaceTitle.status).toBe(400);
      expect(whitespaceTitle.body).toMatchObject({
        statusCode: 400,
        code: ErrorCode.ValidationFailed,
      });
      expect(whitespaceTitle.body.details.length).toBeGreaterThan(0);

      const blankBody = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', user.cookie)
        .send({ title: 'Title', body: '    ', status: PostStatus.DRAFT });
      expect(blankBody.status).toBe(400);
      expect(blankBody.body.code).toBe(ErrorCode.ValidationFailed);
      expect(
        blankBody.body.details.some(
          (detail: { field: string }) => detail.field === 'body',
        ),
      ).toBe(true);

      const invalidStatus = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', user.cookie)
        .send({ title: 'Title', body: 'Body', status: 'archived' });
      expect(invalidStatus.status).toBe(400);
      expect(invalidStatus.body.code).toBe(ErrorCode.ValidationFailed);

      const extraFields = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', user.cookie)
        .send({
          title: 'Title',
          body: 'Body',
          status: PostStatus.DRAFT,
          authorId: new Types.ObjectId().toHexString(),
          likeCount: 100,
        });
      expect(extraFields.status).toBe(400);
      expect(extraFields.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('GET /api/posts/mine (BLG-03)', () => {
    it('lists own drafts and published posts paginated without exposing other users drafts', async () => {
      const alice = await loginAs(testApp!.connection, UserRole.USER);
      const bob = await loginAs(testApp!.connection, UserRole.USER);

      const a1 = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({ title: 'Alice Draft 1', body: 'B1', status: PostStatus.DRAFT });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const a2 = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({
          title: 'Alice Published 2',
          body: 'B2',
          status: PostStatus.PUBLISHED,
        });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const a3 = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({ title: 'Alice Draft 3', body: 'B3', status: PostStatus.DRAFT });

      await testApp!.http().post('/api/posts').set('Cookie', bob.cookie).send({
        title: 'Bob Secret Draft',
        body: 'Secret',
        status: PostStatus.DRAFT,
      });
      await testApp!.http().post('/api/posts').set('Cookie', bob.cookie).send({
        title: 'Bob Public',
        body: 'Public',
        status: PostStatus.PUBLISHED,
      });

      const aliceList = await testApp!
        .http()
        .get('/api/posts/mine')
        .set('Cookie', alice.cookie);

      expect(aliceList.status).toBe(200);
      expect(aliceList.body.total).toBe(3);
      expect(aliceList.body.page).toBe(1);
      expect(aliceList.body.limit).toBe(10);
      expect(aliceList.body.totalPages).toBe(1);
      expect(aliceList.body.items.map((p: { _id: string }) => p._id)).toEqual([
        a3.body._id,
        a2.body._id,
        a1.body._id,
      ]);

      const page2 = await testApp!
        .http()
        .get('/api/posts/mine?page=2&limit=2')
        .set('Cookie', alice.cookie);

      expect(page2.status).toBe(200);
      expect(page2.body.total).toBe(3);
      expect(page2.body.page).toBe(2);
      expect(page2.body.limit).toBe(2);
      expect(page2.body.totalPages).toBe(2);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0]._id).toBe(a1.body._id);

      const bobList = await testApp!
        .http()
        .get('/api/posts/mine')
        .set('Cookie', bob.cookie);
      expect(bobList.status).toBe(200);
      expect(bobList.body.total).toBe(2);
      expect(
        bobList.body.items.some(
          (p: { authorId: string }) => p.authorId === alice.id,
        ),
      ).toBe(false);
    });

    it('rejects invalid pagination query params with 400 VALIDATION_FAILED', async () => {
      const user = await loginAs(testApp!.connection, UserRole.USER);

      const badPage = await testApp!
        .http()
        .get('/api/posts/mine?page=0')
        .set('Cookie', user.cookie);
      expect(badPage.status).toBe(400);
      expect(badPage.body.code).toBe(ErrorCode.ValidationFailed);

      const badLimit = await testApp!
        .http()
        .get('/api/posts/mine?limit=51')
        .set('Cookie', user.cookie);
      expect(badLimit.status).toBe(400);
      expect(badLimit.body.code).toBe(ErrorCode.ValidationFailed);

      const unknownParam = await testApp!
        .http()
        .get('/api/posts/mine?status=published')
        .set('Cookie', user.cookie);
      expect(unknownParam.status).toBe(400);
      expect(unknownParam.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('PATCH /api/posts/:id (BLG-04)', () => {
    it('allows the owner to edit and publish their post while preserving original publishedAt', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);
      const created = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Draft Title',
          body: 'Draft Body',
          status: PostStatus.DRAFT,
        });

      const published = await testApp!
        .http()
        .patch(`/api/posts/${created.body._id}`)
        .set('Cookie', owner.cookie)
        .send({ title: '  Published Title  ', status: PostStatus.PUBLISHED });

      expect(published.status).toBe(200);
      expect(published.body.title).toBe('Published Title');
      expect(published.body.body).toBe('Draft Body');
      expect(published.body.status).toBe(PostStatus.PUBLISHED);
      expect(typeof published.body.publishedAt).toBe('string');

      const originalPublishedAt = published.body.publishedAt as string;

      const updatedBody = await testApp!
        .http()
        .patch(`/api/posts/${created.body._id}`)
        .set('Cookie', owner.cookie)
        .send({ body: 'Updated Body' });

      expect(updatedBody.status).toBe(200);
      expect(updatedBody.body.body).toBe('Updated Body');
      expect(updatedBody.body.publishedAt).toBe(originalPublishedAt);
    });

    it('returns 404 NOT_FOUND when non-owner (including admin) attempts to edit draft or published post', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);
      const otherUser = await loginAs(testApp!.connection, UserRole.USER);
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const draft = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({ title: 'Owner Draft', body: 'Body', status: PostStatus.DRAFT });

      const published = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Owner Published',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        });

      for (const intruder of [otherUser, admin]) {
        for (const target of [draft.body._id, published.body._id]) {
          const res = await testApp!
            .http()
            .patch(`/api/posts/${target}`)
            .set('Cookie', intruder.cookie)
            .send({ title: 'Hijacked' });
          expect(res.status).toBe(404);
          expect(res.body.code).toBe(ErrorCode.NotFound);
        }
      }

      const ownerList = await testApp!
        .http()
        .get('/api/posts/mine')
        .set('Cookie', owner.cookie);
      expect(ownerList.body.items).toHaveLength(2);
      expect(
        ownerList.body.items.map((p: { title: string }) => p.title),
      ).toEqual(expect.arrayContaining(['Owner Draft', 'Owner Published']));
    });

    it('returns 404 on missing post and 400 VALIDATION_FAILED on malformed id or invalid body', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);
      const created = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({ title: 'Title', body: 'Body', status: PostStatus.DRAFT });

      const missingRes = await testApp!
        .http()
        .patch(`/api/posts/${new Types.ObjectId().toHexString()}`)
        .set('Cookie', owner.cookie)
        .send({ title: 'New' });
      expect(missingRes.status).toBe(404);
      expect(missingRes.body.code).toBe(ErrorCode.NotFound);

      const badIdRes = await testApp!
        .http()
        .patch('/api/posts/not-an-id')
        .set('Cookie', owner.cookie)
        .send({ title: 'New' });
      expect(badIdRes.status).toBe(400);
      expect(badIdRes.body.code).toBe(ErrorCode.ValidationFailed);

      const nullFieldRes = await testApp!
        .http()
        .patch(`/api/posts/${created.body._id}`)
        .set('Cookie', owner.cookie)
        .send({ title: null });
      expect(nullFieldRes.status).toBe(400);
      expect(nullFieldRes.body.code).toBe(ErrorCode.ValidationFailed);

      const blankBodyRes = await testApp!
        .http()
        .patch(`/api/posts/${created.body._id}`)
        .set('Cookie', owner.cookie)
        .send({ body: '    ' });
      expect(blankBodyRes.status).toBe(400);
      expect(blankBodyRes.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('DELETE /api/posts/:id (BLG-04)', () => {
    it('allows owner to delete own post (204), cleans up comments & likes, and returns 404 on repeated delete', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);
      const commenter = await loginAs(testApp!.connection, UserRole.USER);

      const created = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Delete Me',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        });

      const postId = new Types.ObjectId(created.body._id as string);
      await commentModel.create({
        postId,
        authorId: new Types.ObjectId(commenter.id),
        body: 'Great tip!',
      });
      await likeModel.create({
        postId,
        userId: new Types.ObjectId(commenter.id),
      });

      const deleteRes = await testApp!
        .http()
        .delete(`/api/posts/${created.body._id}`)
        .set('Cookie', owner.cookie);

      expect(deleteRes.status).toBe(204);
      expect(deleteRes.text).toBe('');
      expect(await commentModel.countDocuments({ postId }).exec()).toBe(0);
      expect(await likeModel.countDocuments({ postId }).exec()).toBe(0);

      const listRes = await testApp!
        .http()
        .get('/api/posts/mine')
        .set('Cookie', owner.cookie);
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(0);

      const repeatRes = await testApp!
        .http()
        .delete(`/api/posts/${created.body._id}`)
        .set('Cookie', owner.cookie);
      expect(repeatRes.status).toBe(404);
      expect(repeatRes.body.code).toBe(ErrorCode.NotFound);
    });

    it('returns 404 NOT_FOUND when non-owner tries to delete draft or published post and leaves it intact', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);
      const intruder = await loginAs(testApp!.connection, UserRole.USER);

      const draft = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({ title: 'Owner Draft', body: 'Body', status: PostStatus.DRAFT });

      const published = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Owner Published',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        });

      for (const targetId of [draft.body._id, published.body._id]) {
        const res = await testApp!
          .http()
          .delete(`/api/posts/${targetId}`)
          .set('Cookie', intruder.cookie);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(ErrorCode.NotFound);
      }

      const ownerList = await testApp!
        .http()
        .get('/api/posts/mine')
        .set('Cookie', owner.cookie);
      expect(ownerList.body.total).toBe(2);
    });

    it('returns 404 on missing post and 400 VALIDATION_FAILED on malformed id', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);

      const missingRes = await testApp!
        .http()
        .delete(`/api/posts/${new Types.ObjectId().toHexString()}`)
        .set('Cookie', owner.cookie);
      expect(missingRes.status).toBe(404);
      expect(missingRes.body.code).toBe(ErrorCode.NotFound);

      const badIdRes = await testApp!
        .http()
        .delete('/api/posts/not-an-id')
        .set('Cookie', owner.cookie);
      expect(badIdRes.status).toBe(400);
      expect(badIdRes.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('GET /api/posts (BLG-02)', () => {
    it('allows guests to receive the empty paginated shape when no published posts exist', async () => {
      const res = await testApp!.http().get('/api/posts');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('paginates published posts, filters by normalised tag, handles unknown tags, and excludes drafts, hidden posts, and deactivated authors', async () => {
      const alice = await loginAs(testApp!.connection, UserRole.USER);
      const bob = await loginAs(testApp!.connection, UserRole.USER);
      const suspended = await loginAs(testApp!.connection, UserRole.USER, {
        status: UserStatus.SUSPENDED,
      });

      Object.assign(
        fakeAccounts,
        new FakeAccountsService([
          { id: alice.id, name: 'Alice Explorer', email: 'alice@example.com' },
          { id: bob.id, name: 'Bob Nomad', email: 'bob@example.com' },
          {
            id: suspended.id,
            name: 'Suspended Author',
            email: 'suspended@example.com',
            status: UserStatus.SUSPENDED,
          },
        ]),
      );

      const p1 = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({ title: 'Siwa', body: 'Oasis 1', status: PostStatus.PUBLISHED });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p2 = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({
          title: 'Fayoum',
          body: 'Oasis 2',
          status: PostStatus.PUBLISHED,
        });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p3 = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({
          title: 'White Desert',
          body: 'Camp 3',
          status: PostStatus.PUBLISHED,
        });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const bobPub = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', bob.cookie)
        .send({ title: 'Nubia', body: 'South', status: PostStatus.PUBLISHED });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const suspendedPub = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', suspended.cookie)
        .send({
          title: 'Karnak',
          body: 'East Bank',
          status: PostStatus.PUBLISHED,
        });
      await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({
          title: 'Private Draft',
          body: 'Hidden',
          status: PostStatus.DRAFT,
        });
      const hiddenPub = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({
          title: 'Admin Hidden',
          body: 'Moderated',
          status: PostStatus.PUBLISHED,
        });

      await postModel.updateMany(
        {
          _id: {
            $in: [p1.body._id, p2.body._id, p3.body._id].map(
              (id: string) => new Types.ObjectId(id),
            ),
          },
        },
        { $set: { tags: ['desert', 'egypt'] } },
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(bobPub.body._id as string) },
        { $set: { tags: ['nile'] } },
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(suspendedPub.body._id as string) },
        { $set: { tags: ['nile'] } },
      );
      await postModel.updateOne(
        { _id: new Types.ObjectId(hiddenPub.body._id as string) },
        { $set: { isHidden: true, tags: ['desert'] } },
      );

      // Pagination boundaries on unfiltered public list (5 visible posts).
      const page1 = await testApp!.http().get('/api/posts?page=1&limit=2');
      expect(page1.status).toBe(200);
      expect(page1.body).toMatchObject({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
      expect(page1.body.items).toHaveLength(2);
      // Suspended user's post and author name remain visible per ACC-16.
      expect(page1.body.items[0]).toMatchObject({
        _id: suspendedPub.body._id,
        authorId: suspended.id,
        authorName: 'Suspended Author',
        title: 'Karnak',
      });
      expect(page1.body.items[1]).toMatchObject({
        _id: bobPub.body._id,
        authorId: bob.id,
        authorName: 'Bob Nomad',
        title: 'Nubia',
        body: 'South',
        tags: ['nile'],
        images: [],
        status: PostStatus.PUBLISHED,
        likeCount: 0,
        commentCount: 0,
        isHidden: false,
        authorDeactivated: false,
      });

      const page2 = await testApp!.http().get('/api/posts?page=2&limit=2');
      expect(page2.status).toBe(200);
      expect(page2.body.items.map((p: { _id: string }) => p._id)).toEqual([
        p3.body._id,
        p2.body._id,
      ]);
      expect(page2.body.items[0].authorName).toBe('Alice Explorer');

      const page3 = await testApp!.http().get('/api/posts?page=3&limit=2');
      expect(page3.status).toBe(200);
      expect(page3.body.items.map((p: { _id: string }) => p._id)).toEqual([
        p1.body._id,
      ]);

      const pageOut = await testApp!.http().get('/api/posts?page=4&limit=2');
      expect(pageOut.status).toBe(200);
      expect(pageOut.body).toEqual({
        items: [],
        page: 4,
        limit: 2,
        total: 5,
        totalPages: 3,
      });

      // Normalised tag filtering (trim & lowercase) and unknown tag empty state.
      const tagged = await testApp!
        .http()
        .get('/api/posts?tag=%20DESERT%20&page=1&limit=2');
      expect(tagged.status).toBe(200);
      expect(tagged.body).toMatchObject({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(tagged.body.items.map((p: { _id: string }) => p._id)).toEqual([
        p3.body._id,
        p2.body._id,
      ]);

      const blankTag = await testApp!.http().get('/api/posts?tag=%20%20');
      expect(blankTag.status).toBe(200);
      expect(blankTag.body.total).toBe(5);

      const unknownTag = await testApp!.http().get('/api/posts?tag=unknown');
      expect(unknownTag.status).toBe(200);
      expect(unknownTag.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });

      // Deactivating Bob excludes Bob's post; reactivating restores it.
      await eventEmitter.emitAsync(Events.UserDeactivated, { userId: bob.id });
      const afterDeactivate = await testApp!
        .http()
        .get('/api/posts')
        .set('Cookie', bob.cookie);
      expect(afterDeactivate.status).toBe(200);
      expect(afterDeactivate.body.total).toBe(4);
      expect(
        afterDeactivate.body.items.some(
          (p: { _id: string }) => p._id === bobPub.body._id,
        ),
      ).toBe(false);

      await eventEmitter.emitAsync(Events.UserReactivated, { userId: bob.id });
      const afterReactivate = await testApp!.http().get('/api/posts');
      expect(afterReactivate.status).toBe(200);
      expect(afterReactivate.body.total).toBe(5);
    });

    it('rejects invalid query parameters with 400 VALIDATION_FAILED', async () => {
      const badPage = await testApp!.http().get('/api/posts?page=0');
      expect(badPage.status).toBe(400);
      expect(badPage.body.code).toBe(ErrorCode.ValidationFailed);

      const badLimit = await testApp!.http().get('/api/posts?limit=51');
      expect(badLimit.status).toBe(400);
      expect(badLimit.body.code).toBe(ErrorCode.ValidationFailed);

      const unknownParam = await testApp!
        .http()
        .get('/api/posts?unknownParam=search');
      expect(unknownParam.status).toBe(400);
      expect(unknownParam.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('GET /api/posts/:id (BLG-02)', () => {
    it('returns the published post page with author name (including suspended author) and omits embedded comments', async () => {
      const author = await loginAs(testApp!.connection, UserRole.USER);
      const suspendedAuthor = await loginAs(
        testApp!.connection,
        UserRole.USER,
        { status: UserStatus.SUSPENDED },
      );

      Object.assign(
        fakeAccounts,
        new FakeAccountsService([
          { id: author.id, name: 'Aisha Rawahi', email: 'aisha@example.com' },
          {
            id: suspendedAuthor.id,
            name: 'Suspended Author',
            email: 'suspended@example.com',
            status: UserStatus.SUSPENDED,
          },
        ]),
      );

      const created = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', author.cookie)
        .send({
          title: 'Luxor Temple Night',
          body: 'Walk along the Sphinx Avenue at dusk.',
          status: PostStatus.PUBLISHED,
        });

      const postId = new Types.ObjectId(created.body._id as string);
      const imageId = new Types.ObjectId();
      await postModel.updateOne(
        { _id: postId },
        {
          $set: {
            tags: ['luxor', 'history'],
            images: [{ _id: imageId, key: 'blog/luxor.jpg' }],
            likeCount: 7,
            commentCount: 3,
          },
        },
      );

      const res = await testApp!.http().get(`/api/posts/${created.body._id}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        _id: created.body._id,
        authorId: author.id,
        authorName: 'Aisha Rawahi',
        title: 'Luxor Temple Night',
        body: 'Walk along the Sphinx Avenue at dusk.',
        tags: ['luxor', 'history'],
        images: [{ _id: imageId.toHexString(), key: 'blog/luxor.jpg' }],
        status: PostStatus.PUBLISHED,
        likeCount: 7,
        commentCount: 3,
        isHidden: false,
        authorDeactivated: false,
      });
      expect(typeof res.body.publishedAt).toBe('string');
      expect(typeof res.body.createdAt).toBe('string');
      expect(typeof res.body.updatedAt).toBe('string');
      expect(res.body.comments).toBeUndefined();

      // A suspended author's own post page remains visible with their author name shown (ACC-16).
      const suspendedPost = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', suspendedAuthor.cookie)
        .send({
          title: 'Suspended Author Post',
          body: 'Remains readable.',
          status: PostStatus.PUBLISHED,
        });
      const suspendedRes = await testApp!
        .http()
        .get(`/api/posts/${suspendedPost.body._id}`);
      expect(suspendedRes.status).toBe(200);
      expect(suspendedRes.body).toMatchObject({
        _id: suspendedPost.body._id,
        authorId: suspendedAuthor.id,
        authorName: 'Suspended Author',
        title: 'Suspended Author Post',
      });
      expect(suspendedRes.body.comments).toBeUndefined();
    });

    it('returns 404 NOT_FOUND for missing, draft (even by owner), hidden, or deactivated-author posts and 400 for malformed id', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);

      const draft = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({ title: 'Draft', body: 'Body', status: PostStatus.DRAFT });

      const hidden = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Hidden',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        });
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden.body._id as string) },
        { $set: { isHidden: true } },
      );

      const missingRes = await testApp!
        .http()
        .get(`/api/posts/${new Types.ObjectId().toHexString()}`);
      expect(missingRes.status).toBe(404);
      expect(missingRes.body.code).toBe(ErrorCode.NotFound);

      const draftGuestRes = await testApp!
        .http()
        .get(`/api/posts/${draft.body._id}`);
      expect(draftGuestRes.status).toBe(404);
      expect(draftGuestRes.body.code).toBe(ErrorCode.NotFound);

      const draftOwnerRes = await testApp!
        .http()
        .get(`/api/posts/${draft.body._id}`)
        .set('Cookie', owner.cookie);
      expect(draftOwnerRes.status).toBe(404);
      expect(draftOwnerRes.body.code).toBe(ErrorCode.NotFound);

      const hiddenRes = await testApp!
        .http()
        .get(`/api/posts/${hidden.body._id}`)
        .set('Cookie', owner.cookie);
      expect(hiddenRes.status).toBe(404);
      expect(hiddenRes.body.code).toBe(ErrorCode.NotFound);

      const activePub = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Owner Published',
          body: 'Visible until deactivated',
          status: PostStatus.PUBLISHED,
        });
      await eventEmitter.emitAsync(Events.UserDeactivated, {
        userId: owner.id,
      });

      const deactivatedRes = await testApp!
        .http()
        .get(`/api/posts/${activePub.body._id}`);
      expect(deactivatedRes.status).toBe(404);
      expect(deactivatedRes.body.code).toBe(ErrorCode.NotFound);

      const badIdRes = await testApp!.http().get('/api/posts/not-an-id');
      expect(badIdRes.status).toBe(400);
      expect(badIdRes.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('POST & GET /api/posts/:id/comments and PATCH & DELETE /api/comments/:id (BLG-05, BLG-07)', () => {
    it('creates comments, lists them chronologically with resolved author names, and keeps commentCount accurate on create/edit/delete', async () => {
      const author = await loginAs(testApp!.connection, UserRole.USER);
      const commenter1 = await loginAs(testApp!.connection, UserRole.USER);
      const commenter2 = await loginAs(testApp!.connection, UserRole.USER);
      const suspendedCommenter = await loginAs(
        testApp!.connection,
        UserRole.USER,
        { status: UserStatus.SUSPENDED },
      );
      const deactivatedCommenterId = new Types.ObjectId().toHexString();

      Object.assign(
        fakeAccounts,
        new FakeAccountsService([
          { id: author.id, name: 'Aisha Rawahi', email: 'aisha@example.com' },
          { id: commenter1.id, name: 'Omar Said', email: 'omar@example.com' },
          {
            id: commenter2.id,
            name: 'Laila Hassan',
            email: 'laila@example.com',
          },
          {
            id: suspendedCommenter.id,
            name: 'Suspended Commenter',
            email: 'suspended-c@example.com',
            status: UserStatus.SUSPENDED,
          },
          {
            id: deactivatedCommenterId,
            name: 'Former User',
            email: 'former@example.com',
            status: UserStatus.DEACTIVATED,
          },
        ]),
      );

      const post = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', author.cookie)
        .send({
          title: 'Sinai Trail Notes',
          body: 'Water sources and camp spots.',
          status: PostStatus.PUBLISHED,
        });
      const postId = post.body._id as string;

      // Minimum boundary (1 char after trim).
      const c1 = await testApp!
        .http()
        .post(`/api/posts/${postId}/comments`)
        .set('Cookie', commenter1.cookie)
        .send({ body: '  a  ' });
      expect(c1.status).toBe(201);
      expect(c1.body).toMatchObject({
        postId,
        authorId: commenter1.id,
        authorName: 'Omar Said',
        body: 'a',
        isHidden: false,
      });

      const after1 = await testApp!.http().get(`/api/posts/${postId}`);
      expect(after1.body.commentCount).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 10));
      // Maximum boundary (500 chars after trim).
      const maxBody = 'x'.repeat(500);
      const c2 = await testApp!
        .http()
        .post(`/api/posts/${postId}/comments`)
        .set('Cookie', commenter2.cookie)
        .send({ body: `  ${maxBody}  ` });
      expect(c2.status).toBe(201);
      expect(c2.body.body).toBe(maxBody);
      expect(c2.body.authorName).toBe('Laila Hassan');

      const after2 = await testApp!.http().get(`/api/posts/${postId}`);
      expect(after2.body.commentCount).toBe(2);

      // Seed an older deactivated comment (visible) + hidden comment + suspended comment to check ordering & visibility.
      await new Promise((resolve) => setTimeout(resolve, 10));
      const c3 = await testApp!
        .http()
        .post(`/api/posts/${postId}/comments`)
        .set('Cookie', suspendedCommenter.cookie)
        .send({ body: 'From suspended commenter' });
      expect(c3.status).toBe(201);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const c4Deactivated = await commentModel.create({
        postId: new Types.ObjectId(postId),
        authorId: new Types.ObjectId(deactivatedCommenterId),
        body: 'Old trip tip',
      });
      await commentModel.create({
        postId: new Types.ObjectId(postId),
        authorId: new Types.ObjectId(commenter1.id),
        body: 'Moderated hidden comment',
        isHidden: true,
      });

      const guestList = await testApp!
        .http()
        .get(`/api/posts/${postId}/comments`);
      expect(guestList.status).toBe(200);
      expect(guestList.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 4,
        totalPages: 1,
      });
      expect(guestList.body.items.map((c: { _id: string }) => c._id)).toEqual([
        c1.body._id,
        c2.body._id,
        c3.body._id,
        c4Deactivated._id.toHexString(),
      ]);
      expect(
        guestList.body.items.map(
          (c: { authorName: string | null }) => c.authorName,
        ),
      ).toEqual([
        'Omar Said',
        'Laila Hassan',
        'Suspended Commenter',
        'Deleted user',
      ]);

      // Post detail page keeps commentCount and does not embed comments (GEN-05).
      const detail = await testApp!.http().get(`/api/posts/${postId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.commentCount).toBe(3);
      expect(detail.body.comments).toBeUndefined();

      // Edit own comment keeps commentCount unchanged.
      const edited = await testApp!
        .http()
        .patch(`/api/comments/${c1.body._id}`)
        .set('Cookie', commenter1.cookie)
        .send({ body: '  Updated trail note!  ' });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({
        _id: c1.body._id,
        body: 'Updated trail note!',
        authorName: 'Omar Said',
      });
      expect(
        (await testApp!.http().get(`/api/posts/${postId}`)).body.commentCount,
      ).toBe(3);

      // Delete own comments decrements commentCount step-by-step and repeated delete returns 404 without going negative.
      const del1 = await testApp!
        .http()
        .delete(`/api/comments/${c1.body._id}`)
        .set('Cookie', commenter1.cookie);
      expect(del1.status).toBe(204);
      expect(
        (await testApp!.http().get(`/api/posts/${postId}`)).body.commentCount,
      ).toBe(2);

      const repeatDel = await testApp!
        .http()
        .delete(`/api/comments/${c1.body._id}`)
        .set('Cookie', commenter1.cookie);
      expect(repeatDel.status).toBe(404);
      expect(repeatDel.body.code).toBe(ErrorCode.NotFound);
      expect(
        (await testApp!.http().get(`/api/posts/${postId}`)).body.commentCount,
      ).toBe(2);

      expect(
        (
          await testApp!
            .http()
            .delete(`/api/comments/${c2.body._id}`)
            .set('Cookie', commenter2.cookie)
        ).status,
      ).toBe(204);
      expect(
        (
          await testApp!
            .http()
            .delete(`/api/comments/${c3.body._id}`)
            .set('Cookie', suspendedCommenter.cookie)
        ).status,
      ).toBe(204);

      const afterAllDeletes = await testApp!.http().get(`/api/posts/${postId}`);
      expect(afterAllDeletes.body.commentCount).toBe(0);
    });

    it('rejects commenting on draft, hidden, deactivated-author, or missing posts and rejects invalid payloads', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);
      const commenter = await loginAs(testApp!.connection, UserRole.USER);

      const draft = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({ title: 'Draft', body: 'Body', status: PostStatus.DRAFT });
      const hidden = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Hidden',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        });
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden.body._id as string) },
        { $set: { isHidden: true } },
      );
      const deactivated = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Deactivated Owner Post',
          body: 'Body',
          status: PostStatus.PUBLISHED,
        });
      await eventEmitter.emitAsync(Events.UserDeactivated, {
        userId: owner.id,
      });

      const published = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', commenter.cookie)
        .send({
          title: 'Valid Post',
          body: 'Open for comments',
          status: PostStatus.PUBLISHED,
        });
      const publishedId = published.body._id as string;

      for (const targetId of [
        draft.body._id,
        hidden.body._id,
        deactivated.body._id,
        new Types.ObjectId().toHexString(),
      ]) {
        const postAttempt = await testApp!
          .http()
          .post(`/api/posts/${targetId}/comments`)
          .set('Cookie', commenter.cookie)
          .send({ body: 'Cannot comment here' });
        expect(postAttempt.status).toBe(404);
        expect(postAttempt.body.code).toBe(ErrorCode.NotFound);

        const listAttempt = await testApp!
          .http()
          .get(`/api/posts/${targetId}/comments`);
        expect(listAttempt.status).toBe(404);
        expect(listAttempt.body.code).toBe(ErrorCode.NotFound);
      }

      expect(
        (await postModel.findById(draft.body._id).lean().exec())?.commentCount,
      ).toBe(0);

      for (const badBody of ['', '   ', 'a'.repeat(501)]) {
        const res = await testApp!
          .http()
          .post(`/api/posts/${publishedId}/comments`)
          .set('Cookie', commenter.cookie)
          .send({ body: badBody });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
      }

      const extraField = await testApp!
        .http()
        .post(`/api/posts/${publishedId}/comments`)
        .set('Cookie', commenter.cookie)
        .send({ body: 'Valid', isHidden: true });
      expect(extraField.status).toBe(400);
      expect(extraField.body.code).toBe(ErrorCode.ValidationFailed);

      const badPostIdCreate = await testApp!
        .http()
        .post('/api/posts/not-an-id/comments')
        .set('Cookie', commenter.cookie)
        .send({ body: 'Valid' });
      expect(badPostIdCreate.status).toBe(400);
      expect(badPostIdCreate.body.code).toBe(ErrorCode.ValidationFailed);

      const badPostIdList = await testApp!
        .http()
        .get('/api/posts/not-an-id/comments');
      expect(badPostIdList.status).toBe(400);
      expect(badPostIdList.body.code).toBe(ErrorCode.ValidationFailed);
    });

    it('rejects edits and deletes by non-owners (including admin), missing comments, and invalid comment input or IDs', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);
      const otherUser = await loginAs(testApp!.connection, UserRole.USER);
      const admin = await loginAs(testApp!.connection, UserRole.ADMIN);

      const post = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Ownership Test',
          body: 'Post body',
          status: PostStatus.PUBLISHED,
        });
      const comment = await testApp!
        .http()
        .post(`/api/posts/${post.body._id}/comments`)
        .set('Cookie', owner.cookie)
        .send({ body: 'Original comment' });
      const commentId = comment.body._id as string;

      for (const intruder of [otherUser, admin]) {
        const editRes = await testApp!
          .http()
          .patch(`/api/comments/${commentId}`)
          .set('Cookie', intruder.cookie)
          .send({ body: 'Hijacked' });
        expect(editRes.status).toBe(404);
        expect(editRes.body.code).toBe(ErrorCode.NotFound);

        const deleteRes = await testApp!
          .http()
          .delete(`/api/comments/${commentId}`)
          .set('Cookie', intruder.cookie);
        expect(deleteRes.status).toBe(404);
        expect(deleteRes.body.code).toBe(ErrorCode.NotFound);
      }

      const missingId = new Types.ObjectId().toHexString();
      expect(
        (
          await testApp!
            .http()
            .patch(`/api/comments/${missingId}`)
            .set('Cookie', owner.cookie)
            .send({ body: 'Missing' })
        ).status,
      ).toBe(404);
      expect(
        (
          await testApp!
            .http()
            .delete(`/api/comments/${missingId}`)
            .set('Cookie', owner.cookie)
        ).status,
      ).toBe(404);

      for (const badBody of ['', '   ', 'a'.repeat(501)]) {
        const res = await testApp!
          .http()
          .patch(`/api/comments/${commentId}`)
          .set('Cookie', owner.cookie)
          .send({ body: badBody });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
      }

      expect(
        (
          await testApp!
            .http()
            .patch('/api/comments/not-an-id')
            .set('Cookie', owner.cookie)
            .send({ body: 'Valid' })
        ).status,
      ).toBe(400);
      expect(
        (
          await testApp!
            .http()
            .delete('/api/comments/not-an-id')
            .set('Cookie', owner.cookie)
        ).status,
      ).toBe(400);

      const detail = await testApp!.http().get(`/api/posts/${post.body._id}`);
      expect(detail.body.commentCount).toBe(1);
      expect(detail.body.comments).toBeUndefined();

      const commentsRes = await testApp!
        .http()
        .get(`/api/posts/${post.body._id}/comments`);
      expect(commentsRes.status).toBe(200);
      expect(commentsRes.body.items[0].body).toBe('Original comment');
    });

    it('paginates comments (default page size 10), supports page 2, orders oldest first with _id tie-break across pages, and validates pagination params', async () => {
      const owner = await loginAs(testApp!.connection, UserRole.USER);
      const commenter = await loginAs(testApp!.connection, UserRole.USER);
      Object.assign(
        fakeAccounts,
        new FakeAccountsService([
          { id: owner.id, name: 'Aisha Rawahi', email: 'aisha@example.com' },
          { id: commenter.id, name: 'Omar Said', email: 'omar@example.com' },
        ]),
      );

      const post = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Paginated Comments Post',
          body: 'Long discussion',
          status: PostStatus.PUBLISHED,
        });
      const postId = post.body._id as string;
      const postObjectId = new Types.ObjectId(postId);
      const commenterObjectId = new Types.ObjectId(commenter.id);

      const baseMs = new Date('2026-11-16T10:00:00.000Z').getTime();
      const tieDate = new Date(baseMs + 90_000);
      await commentModel.insertMany([
        ...Array.from({ length: 9 }, (_, i) => ({
          _id: new Types.ObjectId(),
          postId: postObjectId,
          authorId: commenterObjectId,
          body: `Comment ${i + 1}`,
          isHidden: false,
          createdAt: new Date(baseMs + i * 10_000),
          updatedAt: new Date(baseMs + i * 10_000),
        })),
        // Intentionally insert higher _id first with identical createdAt to prove _id tie-break across page 1 -> page 2.
        {
          _id: new Types.ObjectId('673000000000000000000002'),
          postId: postObjectId,
          authorId: commenterObjectId,
          body: 'Comment 11 (tie _id higher)',
          isHidden: false,
          createdAt: tieDate,
          updatedAt: tieDate,
        },
        {
          _id: new Types.ObjectId('673000000000000000000001'),
          postId: postObjectId,
          authorId: commenterObjectId,
          body: 'Comment 10 (tie _id lower)',
          isHidden: false,
          createdAt: tieDate,
          updatedAt: tieDate,
        },
        {
          _id: new Types.ObjectId(),
          postId: postObjectId,
          authorId: commenterObjectId,
          body: 'Moderated hidden comment',
          isHidden: true,
          createdAt: new Date(baseMs + 5_000),
          updatedAt: new Date(baseMs + 5_000),
        },
        {
          _id: new Types.ObjectId(),
          postId: postObjectId,
          authorId: commenterObjectId,
          body: 'Comment 12',
          isHidden: false,
          createdAt: new Date(baseMs + 100_000),
          updatedAt: new Date(baseMs + 100_000),
        },
      ]);

      const page1 = await testApp!.http().get(`/api/posts/${postId}/comments`);
      expect(page1.status).toBe(200);
      expect(page1.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      expect(page1.body.items).toHaveLength(10);
      expect(page1.body.items.map((c: { body: string }) => c.body)).toEqual([
        ...Array.from({ length: 9 }, (_, i) => `Comment ${i + 1}`),
        'Comment 10 (tie _id lower)',
      ]);

      const page2 = await testApp!
        .http()
        .get(`/api/posts/${postId}/comments?page=2`);
      expect(page2.status).toBe(200);
      expect(page2.body).toMatchObject({
        page: 2,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      expect(page2.body.items.map((c: { body: string }) => c.body)).toEqual([
        'Comment 11 (tie _id higher)',
        'Comment 12',
      ]);

      const pageOut = await testApp!
        .http()
        .get(`/api/posts/${postId}/comments?page=3`);
      expect(pageOut.status).toBe(200);
      expect(pageOut.body).toEqual({
        items: [],
        page: 3,
        limit: 10,
        total: 12,
        totalPages: 2,
      });

      const badPage = await testApp!
        .http()
        .get(`/api/posts/${postId}/comments?page=0`);
      expect(badPage.status).toBe(400);
      expect(badPage.body.code).toBe(ErrorCode.ValidationFailed);

      const badLimit = await testApp!
        .http()
        .get(`/api/posts/${postId}/comments?limit=51`);
      expect(badLimit.status).toBe(400);
      expect(badLimit.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('Tags on create/edit & GET /api/tags/:tag/posts (BLG-08)', () => {
    it('creates and edits posts with normalised deduplicated tags and filters published posts via GET /api/tags/:tag/posts and GET /api/posts?tag=', async () => {
      const alice = await loginAs(testApp!.connection, UserRole.USER);
      const bob = await loginAs(testApp!.connection, UserRole.USER);
      Object.assign(
        fakeAccounts,
        new FakeAccountsService([
          { id: alice.id, name: 'Alice Explorer', email: 'alice@example.com' },
          { id: bob.id, name: 'Bob Nomad', email: 'bob@example.com' },
        ]),
      );

      const post1 = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({
          title: 'First Travel Post',
          body: 'Day one notes.',
          status: PostStatus.PUBLISHED,
          tags: ['Travel', ' travel ', 'TRAVEL', 'Egypt-2026'],
        });
      expect(post1.status).toBe(201);
      expect(post1.body.tags).toEqual(['travel', 'egypt-2026']);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const draftTagged = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', alice.cookie)
        .send({
          title: 'Draft Only Post',
          body: 'Private notes.',
          status: PostStatus.DRAFT,
          tags: ['Travel', 'Draft-Secret'],
        });
      expect(draftTagged.status).toBe(201);
      expect(draftTagged.body.tags).toEqual(['travel', 'draft-secret']);

      const post2 = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', bob.cookie)
        .send({
          title: 'Bob Post Before Tag',
          body: 'To be tagged.',
          status: PostStatus.PUBLISHED,
          tags: ['Cairo'],
        });
      expect(post2.status).toBe(201);
      expect(post2.body.tags).toEqual(['cairo']);

      // Editing post2's title only preserves existing tags.
      const keepTags = await testApp!
        .http()
        .patch(`/api/posts/${post2.body._id}`)
        .set('Cookie', bob.cookie)
        .send({ title: 'Bob Post Renamed' });
      expect(keepTags.status).toBe(200);
      expect(keepTags.body.tags).toEqual(['cairo']);

      // Editing post2's tags replaces and normalises them.
      const updatedTags = await testApp!
        .http()
        .patch(`/api/posts/${post2.body._id}`)
        .set('Cookie', bob.cookie)
        .send({ tags: ['  TRAVEL ', 'travel', 'Nile'] });
      expect(updatedTags.status).toBe(200);
      expect(updatedTags.body.tags).toEqual(['travel', 'nile']);

      // Hidden published post with 'travel' must stay excluded.
      const hiddenPost = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', bob.cookie)
        .send({
          title: 'Hidden Travel',
          body: 'Moderated.',
          status: PostStatus.PUBLISHED,
          tags: ['travel'],
        });
      await postModel.updateOne(
        { _id: new Types.ObjectId(hiddenPost.body._id as string) },
        { $set: { isHidden: true } },
      );

      // List by different spellings of the same tag via GET /api/tags/:tag/posts.
      for (const rawTag of ['Travel', 'TRAVEL', '%20travel%20']) {
        const res = await testApp!.http().get(`/api/tags/${rawTag}/posts`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          page: 1,
          limit: 10,
          total: 2,
          totalPages: 1,
        });
        expect(res.body.items.map((p: { _id: string }) => p._id)).toEqual([
          post2.body._id,
          post1.body._id,
        ]);
        expect(res.body.items[0].authorName).toBe('Bob Nomad');
        expect(res.body.items[1].authorName).toBe('Alice Explorer');
      }

      // Pagination via GET /api/tags/:tag/posts matches BLG-02 GET /api/posts?tag=...
      const pagedTag = await testApp!
        .http()
        .get('/api/tags/travel/posts?page=2&limit=1');
      expect(pagedTag.status).toBe(200);
      expect(pagedTag.body).toMatchObject({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(pagedTag.body.items.map((p: { _id: string }) => p._id)).toEqual([
        post1.body._id,
      ]);

      const blg02Compat = await testApp!
        .http()
        .get('/api/posts?tag=TRAVEL&page=2&limit=1');
      expect(blg02Compat.status).toBe(200);
      expect(blg02Compat.body.items.map((p: { _id: string }) => p._id)).toEqual(
        [post1.body._id],
      );

      // Tag used only on a draft or completely unknown returns an empty page.
      const draftTagRes = await testApp!
        .http()
        .get('/api/tags/draft-secret/posts');
      expect(draftTagRes.status).toBe(200);
      expect(draftTagRes.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });

      const unknownTagRes = await testApp!
        .http()
        .get('/api/tags/unknown-tag/posts');
      expect(unknownTagRes.status).toBe(200);
      expect(unknownTagRes.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });

      // Sending tags: [] clears post tags so it no longer matches.
      const cleared = await testApp!
        .http()
        .patch(`/api/posts/${post2.body._id}`)
        .set('Cookie', bob.cookie)
        .send({ tags: [] });
      expect(cleared.status).toBe(200);
      expect(cleared.body.tags).toEqual([]);

      const afterClear = await testApp!.http().get('/api/tags/travel/posts');
      expect(afterClear.status).toBe(200);
      expect(afterClear.body.total).toBe(1);
      expect(afterClear.body.items.map((p: { _id: string }) => p._id)).toEqual([
        post1.body._id,
      ]);
    });

    it('returns 400 VALIDATION_FAILED for invalid tag payloads, tag params, and pagination queries', async () => {
      const author = await loginAs(testApp!.connection, UserRole.USER);
      const created = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', author.cookie)
        .send({ title: 'Valid', body: 'Body', status: PostStatus.DRAFT });

      for (const badTags of [
        ['t1', 't2', 't3', 't4', 't5', 't6'],
        ['a'.repeat(31)],
        ['   '],
        [''],
        null,
        'egypt',
        [123],
      ]) {
        const createBad = await testApp!
          .http()
          .post('/api/posts')
          .set('Cookie', author.cookie)
          .send({
            title: 'Valid',
            body: 'Body',
            status: PostStatus.DRAFT,
            tags: badTags,
          });
        expect(createBad.status).toBe(400);
        expect(createBad.body.code).toBe(ErrorCode.ValidationFailed);
        expect(
          createBad.body.details.some(
            (d: { field: string }) => d.field === 'tags',
          ),
        ).toBe(true);

        const patchBad = await testApp!
          .http()
          .patch(`/api/posts/${created.body._id}`)
          .set('Cookie', author.cookie)
          .send({ tags: badTags });
        expect(patchBad.status).toBe(400);
        expect(patchBad.body.code).toBe(ErrorCode.ValidationFailed);
        expect(
          patchBad.body.details.some(
            (d: { field: string }) => d.field === 'tags',
          ),
        ).toBe(true);
      }

      const blankTagParam = await testApp!.http().get('/api/tags/%20%20/posts');
      expect(blankTagParam.status).toBe(400);
      expect(blankTagParam.body.code).toBe(ErrorCode.ValidationFailed);
      expect(
        blankTagParam.body.details.some(
          (d: { field: string }) => d.field === 'tag',
        ),
      ).toBe(true);

      const longTagParam = await testApp!
        .http()
        .get(`/api/tags/${'a'.repeat(31)}/posts`);
      expect(longTagParam.status).toBe(400);
      expect(longTagParam.body.code).toBe(ErrorCode.ValidationFailed);

      const badPage = await testApp!
        .http()
        .get('/api/tags/travel/posts?page=0');
      expect(badPage.status).toBe(400);
      expect(badPage.body.code).toBe(ErrorCode.ValidationFailed);

      const badLimit = await testApp!
        .http()
        .get('/api/tags/travel/posts?limit=51');
      expect(badLimit.status).toBe(400);
      expect(badLimit.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('GET /api/posts?q= search (BLG-09)', () => {
    it('searches published posts by title, tag, and author name, orders by engagement then date, includes excerpts, and handles edge cases', async () => {
      const aisha = await loginAs(testApp!.connection, UserRole.USER);
      const tariq = await loginAs(testApp!.connection, UserRole.USER);
      const deactivated = await loginAs(testApp!.connection, UserRole.USER);
      Object.assign(
        fakeAccounts,
        new FakeAccountsService([
          { id: aisha.id, name: 'Aisha Rawahi', email: 'aisha@example.com' },
          { id: tariq.id, name: 'Tariq Oasis', email: 'tariq@example.com' },
          {
            id: deactivated.id,
            name: 'Deactivated Writer',
            email: 'deactivated@example.com',
            status: UserStatus.DEACTIVATED,
          },
        ]),
      );

      const postByTitle = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', aisha.cookie)
        .send({
          title: 'Backpacking Siwa (2026) & Caves',
          body: '<p>Short plain summary for Siwa.</p>',
          status: PostStatus.PUBLISHED,
          tags: ['desert'],
        });
      const postByTag = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', aisha.cookie)
        .send({
          title: 'Western Desert Itinerary',
          body: `Detailed route ${'B'.repeat(210)}`,
          status: PostStatus.PUBLISHED,
          tags: ['Siwa-Camps', 'egypt'],
        });
      const postByAuthor = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', tariq.cookie)
        .send({
          title: 'Morning Coffee',
          body: 'Quiet streets.',
          status: PostStatus.PUBLISHED,
          tags: ['lifestyle'],
        });

      // Draft and hidden posts must never show up in search.
      await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', aisha.cookie)
        .send({
          title: 'Siwa Draft Notes',
          body: 'Private.',
          status: PostStatus.DRAFT,
          tags: ['siwa'],
        });
      const hidden = await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', aisha.cookie)
        .send({
          title: 'Siwa Hidden Notes',
          body: 'Moderated.',
          status: PostStatus.PUBLISHED,
          tags: ['siwa'],
        });
      await postModel.updateOne(
        { _id: new Types.ObjectId(hidden.body._id as string) },
        { $set: { isHidden: true } },
      );

      // Deactivated author's post marked via event must never appear even if searched by author name.
      await testApp!
        .http()
        .post('/api/posts')
        .set('Cookie', deactivated.cookie)
        .send({
          title: 'Siwa Deactivated Post',
          body: 'Gone.',
          status: PostStatus.PUBLISHED,
          tags: ['siwa'],
        });
      await eventEmitter.emitAsync(Events.UserDeactivated, {
        userId: deactivated.id,
      });

      // Raise engagement on postByTag so it outranks postByTitle when both match "siwa".
      await testApp!
        .http()
        .post(`/api/posts/${postByTag.body._id}/comments`)
        .set('Cookie', tariq.cookie)
        .send({ body: 'Awesome Siwa guide!' });
      await postModel.updateOne(
        { _id: new Types.ObjectId(postByTag.body._id as string) },
        { $inc: { likeCount: 3 } },
      );

      // Search by partial case-insensitive keyword matching both title and tag; check engagement sort + excerpt + response shape.
      const siwaPage1 = await testApp!
        .http()
        .get('/api/posts?q=%20SIWA%20&page=1&limit=1');
      expect(siwaPage1.status).toBe(200);
      expect(siwaPage1.body).toMatchObject({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(siwaPage1.body.items[0]).toMatchObject({
        _id: postByTag.body._id,
        authorName: 'Aisha Rawahi',
        title: 'Western Desert Itinerary',
        likeCount: 3,
        commentCount: 1,
        excerpt: `Detailed route ${'B'.repeat(185)}...`,
      });

      const siwaPage2 = await testApp!
        .http()
        .get('/api/posts?q=siwa&page=2&limit=1');
      expect(siwaPage2.status).toBe(200);
      expect(siwaPage2.body.items[0]).toMatchObject({
        _id: postByTitle.body._id,
        authorName: 'Aisha Rawahi',
        excerpt: 'Short plain summary for Siwa.',
      });

      // Combine q + tag filter.
      const combined = await testApp!
        .http()
        .get('/api/posts?q=siwa&tag=DESERT');
      expect(combined.status).toBe(200);
      expect(combined.body.items.map((p: { _id: string }) => p._id)).toEqual([
        postByTitle.body._id,
      ]);

      // Search by partial case-insensitive author name.
      const authorSearch = await testApp!.http().get('/api/posts?q=tari');
      expect(authorSearch.status).toBe(200);
      expect(
        authorSearch.body.items.map((p: { _id: string }) => p._id),
      ).toEqual([postByAuthor.body._id]);
      expect(authorSearch.body.items[0].authorName).toBe('Tariq Oasis');
      expect(authorSearch.body.items[0].excerpt).toBe('Quiet streets.');

      // Special regex characters match literally without 500 error.
      const specialCharSearch = await testApp!
        .http()
        .get('/api/posts?q=(2026)%20%26');
      expect(specialCharSearch.status).toBe(200);
      expect(
        specialCharSearch.body.items.map((p: { _id: string }) => p._id),
      ).toEqual([postByTitle.body._id]);

      // Deactivated author search returns empty page; unknown query returns empty page.
      const deactivatedSearch = await testApp!
        .http()
        .get('/api/posts?q=Deactivated');
      expect(deactivatedSearch.status).toBe(200);
      expect(deactivatedSearch.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });

      const noResults = await testApp!.http().get('/api/posts?q=patagonia');
      expect(noResults.status).toBe(200);
      expect(noResults.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });

      // Empty or whitespace-only q acts as unfiltered published browse.
      const blankSearch = await testApp!.http().get('/api/posts?q=%20%20%20');
      expect(blankSearch.status).toBe(200);
      expect(blankSearch.body.total).toBe(3);

      // Overlong q (> 150 chars) fails validation cleanly with 400 VALIDATION_FAILED on field 'q'.
      const overlongSearch = await testApp!
        .http()
        .get(`/api/posts?q=${'x'.repeat(151)}`);
      expect(overlongSearch.status).toBe(400);
      expect(overlongSearch.body.code).toBe(ErrorCode.ValidationFailed);
      expect(
        overlongSearch.body.details.some(
          (d: { field: string }) => d.field === 'q',
        ),
      ).toBe(true);
    });

    it.each([
      { label: '76 x 😀 (152 UTF-16 units)', q: '😀'.repeat(76) },
      { label: '150 x 😀 (300 UTF-16 units)', q: '😀'.repeat(150) },
      { label: '150 x "a"', q: 'a'.repeat(150) },
      {
        label: 'mixed emoji and letters at 150 code points',
        q: `${'a'.repeat(50)}${'😀'.repeat(100)}`,
      },
    ])('returns 200 for q with $label (BLG-09)', async ({ q }) => {
      const res = await testApp!
        .http()
        .get(`/api/posts?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
      });
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(typeof res.body.totalPages).toBe('number');
    });

    it.each([
      { label: '151 x 😀', q: '😀'.repeat(151) },
      { label: '151 x "a"', q: 'a'.repeat(151) },
    ])(
      'returns 400 VALIDATION_FAILED for overlong q with $label (BLG-09)',
      async ({ q }) => {
        const res = await testApp!
          .http()
          .get(`/api/posts?q=${encodeURIComponent(q)}`);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
        expect(
          res.body.details.map((d: { field: string }) => d.field),
        ).toContain('q');
      },
    );
  });
});
