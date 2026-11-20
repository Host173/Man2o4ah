import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type request from 'supertest';
import { createFullApp, JOURNEY_TIMEOUT } from '../support/full-app.js';
import type { Actor, FullApp } from '../support/full-app.js';
import { imageBytes } from '../support/image-fixtures.js';
import { HOOK_TIMEOUT } from '../support/mongo-memory.js';

interface ImageBody {
  _id: string;
  key: string;
  url: string;
}

interface PostBody {
  _id: string;
  authorId: string;
  title: string;
  status: string;
  tags: string[];
  images: ImageBody[];
  likeCount: number;
  commentCount: number;
  isHidden: boolean;
}

interface CommentBody {
  _id: string;
  postId: string;
  authorId: string;
  body: string;
  isHidden: boolean;
}

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ReportBody {
  _id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  resolvedBy?: string;
}

interface AuditBody {
  action: string;
  actorId: string;
  target: { type: string; id: string };
  details?: Record<string, unknown>;
}

interface LikeBody {
  postId: string;
  likeCount: number;
  liked: boolean;
}

describe(
  'Blog to moderation journey (BLG-01..10, GEN-07..10)',
  { timeout: JOURNEY_TIMEOUT },
  () => {
    let app: FullApp;

    beforeAll(async () => {
      app = await createFullApp();
    }, HOOK_TIMEOUT);
    afterAll(() => app.t.close(), HOOK_TIMEOUT);

    const guest = () => app.t.http();
    const uniqueTag = () => `e2e${randomUUID().slice(0, 8)}`;

    function attachImage(
      call: request.Test,
      format: 'jpg' | 'png' = 'png',
    ): request.Test {
      return call.attach('file', imageBytes(format), {
        filename: `photo.${format}`,
        contentType: format === 'png' ? 'image/png' : 'image/jpeg',
      });
    }

    async function createPost(
      author: Actor,
      options: { status?: 'draft' | 'published'; tag?: string } = {},
    ): Promise<PostBody> {
      const res = await author
        .post('/api/posts')
        .send({
          title: `Journey post ${randomUUID()}`,
          body: 'Start at the pyramids early in the morning.',
          status: options.status ?? 'published',
          tags: [options.tag ?? uniqueTag()],
        })
        .expect(201);
      return res.body as PostBody;
    }

    async function addImage(
      author: Actor,
      postId: string,
      format: 'jpg' | 'png' = 'png',
    ): Promise<PostBody> {
      const res = await attachImage(
        author.post(`/api/posts/${postId}/images`),
        format,
      ).expect(201);
      return res.body as PostBody;
    }

    async function comment(
      who: Actor,
      postId: string,
      body: string,
    ): Promise<CommentBody> {
      const res = await who
        .post(`/api/posts/${postId}/comments`)
        .send({ body })
        .expect(201);
      return res.body as CommentBody;
    }

    async function report(
      who: Actor,
      targetType: 'post' | 'comment',
      targetId: string,
      reason = 'Spam links unrelated to travel',
    ): Promise<ReportBody> {
      const res = await who
        .post('/api/reports')
        .send({ targetType, targetId, reason })
        .expect(201);
      return res.body as ReportBody;
    }

    async function openReports(admin: Actor): Promise<ReportBody[]> {
      const res = await admin.get('/api/admin/reports?limit=50').expect(200);
      return (res.body as Page<ReportBody>).items;
    }

    async function postsOfTag(tag: string): Promise<PostBody[]> {
      const res = await guest().get(`/api/tags/${tag}/posts`).expect(200);
      return (res.body as Page<PostBody>).items;
    }

    async function auditEntries(
      admin: Actor,
      action: string,
      targetId: string,
    ): Promise<AuditBody[]> {
      const res = await admin
        .get(`/api/admin/audit-logs?limit=50&action=${action}`)
        .expect(200);
      return (res.body as Page<AuditBody>).items.filter(
        (entry) => entry.target.id === targetId,
      );
    }

    async function expectFileExists(key: string, exists: boolean) {
      const check = access(join(app.t.uploadDir, key));
      if (exists) await expect(check).resolves.toBeUndefined();
      else await expect(check).rejects.toThrow();
    }

    it('publishes a post with images, then comments and idempotent likes build up its page (BLG-01, BLG-05, BLG-06, BLG-10)', async () => {
      const author = await app.newUser('Blog Author');
      const reader = await app.newUser('Blog Reader');
      const tag = uniqueTag();
      const post = await createPost(author, { tag });
      expect(post).toMatchObject({
        authorId: expect.any(String),
        status: 'published',
        tags: [tag],
        likeCount: 0,
        commentCount: 0,
        isHidden: false,
      });

      const withPng = await addImage(author, post._id, 'png');
      const withJpg = await addImage(author, post._id, 'jpg');
      expect(withPng.images).toHaveLength(1);
      expect(withJpg.images).toHaveLength(2);
      const [png, jpg] = withJpg.images as [ImageBody, ImageBody];
      expect(png.url).toBe(`/uploads/${png.key}`);
      expect(png.key).toMatch(/\.png$/);
      expect(jpg.key).toMatch(/\.jpg$/);
      const served = await guest().get(png.url).expect(200);
      expect(served.headers['content-type']).toContain('image/png');

      const page = await guest().get(`/api/posts/${post._id}`).expect(200);
      expect(page.body).toMatchObject({
        _id: post._id,
        authorName: 'Blog Author',
        images: [{ key: png.key }, { key: jpg.key }],
      });
      expect((await postsOfTag(tag)).map((listed) => listed._id)).toEqual([
        post._id,
      ]);
      const search = await guest()
        .get(`/api/posts?q=${encodeURIComponent(post.title)}`)
        .expect(200);
      expect((search.body as Page<PostBody>).items.map((p) => p._id)).toEqual([
        post._id,
      ]);

      await comment(reader, post._id, 'First comment');
      await comment(author, post._id, 'Second comment');
      const comments = await guest()
        .get(`/api/posts/${post._id}/comments`)
        .expect(200);
      expect(
        (comments.body as Page<CommentBody>).items.map((c) => c.body),
      ).toEqual(['First comment', 'Second comment']);
      await reader
        .post(`/api/posts/${post._id}/comments`)
        .send({ body: '   ' })
        .expect(400);
      await reader
        .post(`/api/posts/${post._id}/comments`)
        .send({ body: 'x'.repeat(501) })
        .expect(400);
      await guest()
        .post(`/api/posts/${post._id}/comments`)
        .send({ body: 'Anonymous' })
        .expect(401);

      const liked = await reader
        .post(`/api/posts/${post._id}/like`)
        .expect(200);
      expect(liked.body as LikeBody).toEqual({
        postId: post._id,
        likeCount: 1,
        liked: true,
      });
      const likedAgain = await reader
        .post(`/api/posts/${post._id}/like`)
        .expect(200);
      expect((likedAgain.body as LikeBody).likeCount).toBe(1);
      const authorLike = await author
        .post(`/api/posts/${post._id}/like`)
        .expect(200);
      expect((authorLike.body as LikeBody).likeCount).toBe(2);
      await guest().post(`/api/posts/${post._id}/like`).expect(401);

      const counted = await guest().get(`/api/posts/${post._id}`).expect(200);
      expect(counted.body).toMatchObject({ likeCount: 2, commentCount: 2 });

      const unliked = await reader
        .delete(`/api/posts/${post._id}/like`)
        .expect(200);
      expect(unliked.body as LikeBody).toMatchObject({
        likeCount: 1,
        liked: false,
      });
      const unlikedAgain = await reader
        .delete(`/api/posts/${post._id}/like`)
        .expect(200);
      expect(unlikedAgain.body as LikeBody).toMatchObject({
        likeCount: 1,
        liked: false,
      });
    });

    it('keeps a draft private to its author until it is published (BLG-01, BLG-03)', async () => {
      const author = await app.newUser('Draft Author');
      const reader = await app.newUser();
      const tag = uniqueTag();
      const draft = await createPost(author, { status: 'draft', tag });
      expect(draft.status).toBe('draft');

      const mine = await author.get('/api/posts/mine').expect(200);
      expect(
        (mine.body as Page<PostBody>).items.find((p) => p._id === draft._id),
      ).toMatchObject({ status: 'draft' });
      expect(await postsOfTag(tag)).toEqual([]);
      await guest().get(`/api/posts/${draft._id}`).expect(404);
      await reader.get(`/api/posts/${draft._id}`).expect(404);
      await reader
        .post(`/api/posts/${draft._id}/comments`)
        .send({ body: 'Too early' })
        .expect(404);
      await reader.post(`/api/posts/${draft._id}/like`).expect(404);

      const published = await author
        .patch(`/api/posts/${draft._id}`)
        .send({ status: 'published' })
        .expect(200);
      expect(published.body).toMatchObject({ status: 'published' });
      expect((await postsOfTag(tag)).map((listed) => listed._id)).toEqual([
        draft._id,
      ]);
      await guest().get(`/api/posts/${draft._id}`).expect(200);
    });

    it('enforces image rules and author-only changes on a post (BLG-04, BLG-10, GEN-08)', async () => {
      const author = await app.newUser();
      const stranger = await app.newUser();
      const post = await createPost(author);

      await attachImage(stranger.post(`/api/posts/${post._id}/images`)).expect(
        404,
      );
      await stranger
        .patch(`/api/posts/${post._id}`)
        .send({ title: 'Hijacked' })
        .expect(404);
      await stranger.delete(`/api/posts/${post._id}`).expect(404);
      await attachImage(guest().post(`/api/posts/${post._id}/images`)).expect(
        401,
      );

      const gif = await author
        .post(`/api/posts/${post._id}/images`)
        .attach('file', Buffer.from('GIF89a-not-allowed'), {
          filename: 'a.gif',
          contentType: 'image/gif',
        })
        .expect(400);
      expect(gif.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      await author
        .post(`/api/posts/${post._id}/images`)
        .attach('file', Buffer.from('not really a png'), {
          filename: 'fake.png',
          contentType: 'image/png',
        })
        .expect(400);
      await author
        .post(`/api/posts/${post._id}/images`)
        .attach('file', imageBytes('png', 5 * 1024 * 1024 + 1), {
          filename: 'huge.png',
          contentType: 'image/png',
        })
        .expect(413);

      let current = post;
      for (let count = 0; count < 5; count += 1) {
        current = await addImage(author, post._id, count % 2 ? 'jpg' : 'png');
      }
      expect(current.images).toHaveLength(5);
      const sixth = await attachImage(
        author.post(`/api/posts/${post._id}/images`),
      ).expect(400);
      expect(sixth.body).toMatchObject({ code: 'LIMIT_EXCEEDED' });

      const [removed, ...kept] = current.images as [ImageBody, ...ImageBody[]];
      await stranger
        .delete(`/api/posts/${post._id}/images/${removed._id}`)
        .expect(404);
      await author
        .delete(`/api/posts/${post._id}/images/${removed._id}`)
        .expect(204);
      await expectFileExists(removed.key, false);
      await guest().get(removed.url).expect(404);
      const after = await guest().get(`/api/posts/${post._id}`).expect(200);
      expect((after.body as PostBody).images.map((i) => i._id)).toEqual(
        kept.map((i) => i._id),
      );

      await author.delete(`/api/posts/${post._id}`).expect(204);
      await guest().get(`/api/posts/${post._id}`).expect(404);
      for (const image of kept) {
        await vi.waitFor(() => expectFileExists(image.key, false));
      }
    });

    it('lets a commenter edit and delete only their own comment (BLG-07)', async () => {
      const author = await app.newUser();
      const commenter = await app.newUser();
      const other = await app.newUser();
      const post = await createPost(author);
      const mine = await comment(commenter, post._id, 'Original text');

      await other
        .patch(`/api/comments/${mine._id}`)
        .send({ body: 'Hijacked' })
        .expect(404);
      await other.delete(`/api/comments/${mine._id}`).expect(404);
      const edited = await commenter
        .patch(`/api/comments/${mine._id}`)
        .send({ body: 'Edited text' })
        .expect(200);
      expect((edited.body as CommentBody).body).toBe('Edited text');

      await commenter.delete(`/api/comments/${mine._id}`).expect(204);
      const page = await guest().get(`/api/posts/${post._id}`).expect(200);
      expect((page.body as PostBody).commentCount).toBe(0);
    });

    it('hides a reported post from lists and visitors but not from its author or admins (BLG-02, GEN-09, GEN-10)', async () => {
      const admin = await app.admin();
      const author = await app.newUser('Reported Author');
      const reporter = await app.newUser('Reporter');
      const second = await app.newUser('Second Reporter');
      const reader = await app.newUser();
      const tag = uniqueTag();
      const post = await createPost(author, { tag });
      await addImage(author, post._id);
      await comment(reader, post._id, 'Nice tips');

      const first = await report(reporter, 'post', post._id);
      expect(first).toMatchObject({
        targetType: 'post',
        targetId: post._id,
        status: 'open',
      });
      expect(first.reporterId).not.toBe(post.authorId);
      const duplicate = await reporter
        .post('/api/reports')
        .send({ targetType: 'post', targetId: post._id, reason: 'Again' })
        .expect(409);
      expect(duplicate.body).toMatchObject({ code: 'ALREADY_REPORTED' });
      const other = await report(second, 'post', post._id, 'Misleading');
      await reporter
        .post('/api/reports')
        .send({
          targetType: 'post',
          targetId: '6553a1f0c2b4e8a9d0f1a8ff',
          reason: 'Gone',
        })
        .expect(404);
      await guest()
        .post('/api/reports')
        .send({ targetType: 'post', targetId: post._id, reason: 'Anon' })
        .expect(401);

      await reporter.get('/api/admin/reports').expect(403);
      await guest().get('/api/admin/reports').expect(401);
      const open = await openReports(admin);
      expect(
        open
          .filter((r) => r.targetId === post._id)
          .map((r) => r._id)
          .sort(),
      ).toEqual([first._id, other._id].sort());
      await reporter
        .patch(`/api/admin/reports/${first._id}`)
        .send({ action: 'hide' })
        .expect(403);

      const resolved = await admin
        .patch(`/api/admin/reports/${first._id}`)
        .send({ action: 'hide' })
        .expect(200);
      expect(resolved.body as ReportBody).toMatchObject({
        _id: first._id,
        status: 'content_hidden',
      });
      expect((resolved.body as ReportBody).resolvedBy).toBeDefined();
      await admin
        .patch(`/api/admin/reports/${first._id}`)
        .send({ action: 'dismiss' })
        .expect(409);

      const closed = await admin
        .get('/api/admin/reports?status=content_hidden&limit=50')
        .expect(200);
      expect(
        (closed.body as Page<ReportBody>).items
          .filter((r) => r.targetId === post._id)
          .map((r) => r._id)
          .sort(),
      ).toEqual([first._id, other._id].sort());
      expect(
        (await openReports(admin)).some((r) => r.targetId === post._id),
      ).toBe(false);

      expect(await postsOfTag(tag)).toEqual([]);
      const listed = await guest()
        .get(`/api/posts?q=${encodeURIComponent(post.title)}`)
        .expect(200);
      expect((listed.body as Page<PostBody>).items).toEqual([]);
      await guest().get(`/api/posts/${post._id}`).expect(404);
      await reader.get(`/api/posts/${post._id}`).expect(404);
      await reader.post(`/api/posts/${post._id}/like`).expect(404);
      await reader
        .post(`/api/posts/${post._id}/comments`)
        .send({ body: 'Late' })
        .expect(404);

      const own = await author.get(`/api/posts/${post._id}`).expect(200);
      expect(own.body as PostBody).toMatchObject({
        _id: post._id,
        isHidden: true,
        commentCount: 1,
      });
      const byAdmin = await admin.get(`/api/posts/${post._id}`).expect(200);
      expect((byAdmin.body as PostBody).isHidden).toBe(true);
      const mine = await author.get('/api/posts/mine').expect(200);
      expect(
        (mine.body as Page<PostBody>).items.find((p) => p._id === post._id),
      ).toMatchObject({ isHidden: true });
      await author.get(`/api/posts/${post._id}/comments`).expect(200);
      await reader.get(`/api/posts/${post._id}/comments`).expect(404);

      const adminId = (resolved.body as ReportBody).resolvedBy;
      await vi.waitFor(async () => {
        const hidden = await auditEntries(admin, 'content_hidden', post._id);
        expect(hidden).toHaveLength(1);
        expect(hidden[0]).toMatchObject({
          actorId: adminId,
          target: { type: 'post', id: post._id },
          details: { reportId: first._id },
        });
        const resolvedEntries = await auditEntries(
          admin,
          'report_resolved',
          first._id,
        );
        expect(resolvedEntries).toHaveLength(1);
        expect(resolvedEntries[0]).toMatchObject({
          actorId: adminId,
          target: { type: 'report', id: first._id },
          details: { action: 'hide', targetId: post._id, closedCount: 2 },
        });
      });

      // GEN-01 lists no notification for moderation outcomes.
      for (const person of [author, reporter]) {
        const unread = await person.get('/api/notifications/unread-count');
        expect(unread.status).toBe(200);
        expect(unread.body).toEqual({ count: 0 });
      }
    });

    it('dismisses a report and leaves the post visible (GEN-10)', async () => {
      const admin = await app.admin();
      const author = await app.newUser();
      const reporter = await app.newUser();
      const tag = uniqueTag();
      const post = await createPost(author, { tag });
      const filed = await report(reporter, 'post', post._id, 'Looks fine');

      const dismissed = await admin
        .patch(`/api/admin/reports/${filed._id}`)
        .send({ action: 'dismiss' })
        .expect(200);
      expect((dismissed.body as ReportBody).status).toBe('dismissed');
      expect((await postsOfTag(tag)).map((p) => p._id)).toEqual([post._id]);
      await guest().get(`/api/posts/${post._id}`).expect(200);
      await vi.waitFor(async () => {
        const entries = await auditEntries(admin, 'report_resolved', filed._id);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.details).toMatchObject({ action: 'dismiss' });
      });
      expect(await auditEntries(admin, 'content_hidden', post._id)).toEqual([]);
    });

    it('lets an admin hide a post directly and rejects other roles (GEN-10)', async () => {
      const admin = await app.admin();
      const author = await app.newUser();
      const tag = uniqueTag();
      const post = await createPost(author, { tag });

      await author
        .patch(`/api/admin/content/post/${post._id}/hide`)
        .expect(403);
      await admin
        .patch('/api/admin/content/post/6553a1f0c2b4e8a9d0f1a8fe/hide')
        .expect(404);
      await admin.patch(`/api/admin/content/post/${post._id}/hide`).expect(204);
      expect(await postsOfTag(tag)).toEqual([]);
      await guest().get(`/api/posts/${post._id}`).expect(404);
      await author.get(`/api/posts/${post._id}`).expect(200);
      await vi.waitFor(async () => {
        const entries = await auditEntries(admin, 'content_hidden', post._id);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ target: { type: 'post' } });
      });
    });

    it('deletes a reported comment as admin and keeps the post counters right (GEN-09, GEN-10, GEN-07)', async () => {
      const admin = await app.admin();
      const author = await app.newUser();
      const commenter = await app.newUser();
      const reporter = await app.newUser();
      const post = await createPost(author);
      const bad = await comment(commenter, post._id, 'Buy cheap pills');
      await comment(author, post._id, 'Thanks for reading');
      const filed = await report(reporter, 'comment', bad._id);
      expect(filed).toMatchObject({ targetType: 'comment', status: 'open' });

      await reporter
        .delete(`/api/admin/content/comment/${bad._id}`)
        .expect(403);
      await admin.delete(`/api/admin/content/comment/${bad._id}`).expect(204);
      await admin.delete(`/api/admin/content/comment/${bad._id}`).expect(404);

      const comments = await guest()
        .get(`/api/posts/${post._id}/comments`)
        .expect(200);
      expect(
        (comments.body as Page<CommentBody>).items.map((c) => c.body),
      ).toEqual(['Thanks for reading']);
      const page = await guest().get(`/api/posts/${post._id}`).expect(200);
      expect((page.body as PostBody).commentCount).toBe(1);
      const closed = await admin
        .get('/api/admin/reports?status=content_deleted&limit=50')
        .expect(200);
      expect(
        (closed.body as Page<ReportBody>).items.map((r) => r._id),
      ).toContain(filed._id);

      await vi.waitFor(async () => {
        const entries = await auditEntries(admin, 'content_deleted', bad._id);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          target: { type: 'comment', id: bad._id },
          details: { closedReportCount: 1 },
        });
      });
    });

    it('hides a comment: others stop seeing it, its author still does (GEN-10)', async () => {
      const admin = await app.admin();
      const author = await app.newUser();
      const commenter = await app.newUser();
      const post = await createPost(author);
      const hidden = await comment(commenter, post._id, 'Borderline remark');
      await comment(author, post._id, 'Visible remark');

      await admin
        .patch(`/api/admin/content/comment/${hidden._id}/hide`)
        .expect(204);

      const forOthers = await guest()
        .get(`/api/posts/${post._id}/comments`)
        .expect(200);
      expect(
        (forOthers.body as Page<CommentBody>).items.map((c) => c.body),
      ).toEqual(['Visible remark']);
      const forAuthor = await commenter
        .get(`/api/posts/${post._id}/comments`)
        .expect(200);
      expect(
        (forAuthor.body as Page<CommentBody>).items.map((c) => c.isHidden),
      ).toEqual([true, false]);
      const page = await guest().get(`/api/posts/${post._id}`).expect(200);
      expect((page.body as PostBody).commentCount).toBe(1);
    });

    it('deletes a post through a report: comments, likes and image files go too (GEN-10, BLG-10)', async () => {
      const admin = await app.admin();
      const author = await app.newUser();
      const reader = await app.newUser();
      const reporter = await app.newUser();
      const tag = uniqueTag();
      const post = await createPost(author, { tag });
      const withImage = await addImage(author, post._id, 'jpg');
      const [image] = withImage.images as [ImageBody];
      await expectFileExists(image.key, true);
      await comment(reader, post._id, 'Will vanish');
      await reader.post(`/api/posts/${post._id}/like`).expect(200);
      const filed = await report(reporter, 'post', post._id);

      const resolved = await admin
        .patch(`/api/admin/reports/${filed._id}`)
        .send({ action: 'delete' })
        .expect(200);
      expect((resolved.body as ReportBody).status).toBe('content_deleted');

      await guest().get(`/api/posts/${post._id}`).expect(404);
      await author.get(`/api/posts/${post._id}`).expect(404);
      await guest().get(`/api/posts/${post._id}/comments`).expect(404);
      expect(await postsOfTag(tag)).toEqual([]);
      const mine = await author.get('/api/posts/mine').expect(200);
      expect(
        (mine.body as Page<PostBody>).items.some((p) => p._id === post._id),
      ).toBe(false);
      await vi.waitFor(() => expectFileExists(image.key, false));
      await vi.waitFor(async () => {
        const entries = await auditEntries(admin, 'content_deleted', post._id);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          target: { type: 'post', id: post._id },
          details: { reportId: filed._id },
        });
      });
    });
  },
);
