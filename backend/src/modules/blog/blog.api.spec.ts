import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { BlogModule } from './blog.module.js';
import { Comment, type CommentDocument } from './schemas/comment.schema.js';
import { Like, type LikeDocument } from './schemas/like.schema.js';
import { PostStatus } from './schemas/post.schema.js';

describe('BlogController HTTP API (BLG-01, BLG-03, BLG-04)', () => {
  let testApp: TestApp | undefined;
  let commentModel: Model<CommentDocument>;
  let likeModel: Model<LikeDocument>;

  beforeAll(async () => {
    testApp = await createTestApp({ imports: [BlogModule] });
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

  it('registers Swagger paths and schemas for blog endpoints', () => {
    const document = SwaggerModule.createDocument(
      testApp!.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .build(),
    );

    expect(document.paths['/api/posts']?.post).toBeDefined();
    expect(document.paths['/api/posts/mine']?.get).toBeDefined();
    expect(document.paths['/api/posts/{id}']?.patch).toBeDefined();
    expect(document.paths['/api/posts/{id}']?.delete).toBeDefined();
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
});
