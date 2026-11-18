import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model, QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import { Events } from '../../common/events/events.js';
import { paginate } from '../../common/pagination/paginate.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { AccountsService } from '../accounts/accounts.service.js';
import type { AccountProfile } from '../accounts/accounts.types.js';
import { UserRole, UserStatus } from '../accounts/schemas/user.schema.js';
import { ItinerariesService } from '../itineraries/itineraries.service.js';
import {
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_POST,
  MIN_TAG_LENGTH,
  normalizeTag,
  normalizeTags,
} from './blog-tags.js';
import type {
  AuthorPageView,
  CommentView,
  PostDetailView,
  PostLikeView,
  PostView,
  PublishedPostView,
} from './blog.types.js';
import { AuthorPageQueryDto } from './dto/author-page-query.dto.js';
import type { CreateCommentDto } from './dto/create-comment.dto.js';
import type { CreatePostDto } from './dto/create-post.dto.js';
import { ListPostsQueryDto } from './dto/list-posts-query.dto.js';
import type { UpdateCommentDto } from './dto/update-comment.dto.js';
import type { UpdatePostDto } from './dto/update-post.dto.js';
import { Comment } from './schemas/comment.schema.js';
import { Like } from './schemas/like.schema.js';
import { Post, PostStatus } from './schemas/post.schema.js';

type StoredPost = Omit<Post, 'images'> & {
  images: (Post['images'][number] & { _id: Types.ObjectId })[];
  createdAt: Date;
  updatedAt: Date;
};
type PostRecord = StoredPost & { _id: Types.ObjectId };
type StoredComment = Comment & { createdAt: Date; updatedAt: Date };
type CommentRecord = StoredComment & { _id: Types.ObjectId };

const OBJECT_ID_HEX_RE = /^[0-9a-fA-F]{24}$/;
const DELETED_USER_NAME = 'Deleted user';

/**
 * Travel blog post, tag, author page, and comment workflows (BLG-01, BLG-02, BLG-03, BLG-04, BLG-05, BLG-07, BLG-08, BLG-12, ACC-12).
 * Other blog endpoints and listeners ship in later Sprint 2 tickets.
 */
@Injectable()
export class BlogService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Post.name) private readonly postModel: Model<StoredPost>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<StoredComment>,
    @InjectModel(Like.name) private readonly likeModel: Model<Like>,
    private readonly accountsService: AccountsService,
    private readonly itinerariesService: ItinerariesService,
  ) {}

  /** BLG-01 / BLG-08: creates a post as draft or published owned by the authenticated user. */
  async create(dto: CreatePostDto, userId: string): Promise<PostView> {
    const authorId = this.parseId(userId, 'userId');
    this.assertNonBlankBody(dto.body);
    const tags = dto.tags !== undefined ? this.prepareTags(dto.tags) : [];
    const created = await this.postModel.create({
      authorId,
      title: dto.title.trim(),
      body: dto.body,
      tags,
      status: dto.status,
      ...(dto.status === PostStatus.PUBLISHED
        ? { publishedAt: new Date() }
        : {}),
    });
    return this.toView(created.toObject() as PostRecord);
  }

  /**
   * BLG-02 / BLG-08: lists paginated published posts (newest `publishedAt`
   * first), optionally filtered by normalised tag, excluding drafts, hidden
   * posts and deactivated authors' posts.
   */
  async listPublished(
    query: ListPostsQueryDto = new ListPostsQueryDto(),
  ): Promise<Paginated<PublishedPostView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const tag = query.tag !== undefined ? normalizeTag(query.tag) : undefined;
    return this.paginatePublishedPosts(tag ? { tags: tag } : {}, {
      page,
      limit,
    });
  }

  /**
   * BLG-12: loads the public author page showing display name, join date,
   * independently paginated published posts and public itineraries (`CTR-06`).
   * Throws 404 for unknown, deactivated, or non-user (admin/moderator) accounts.
   */
  async getAuthorPage(
    authorId: string,
    query: Partial<AuthorPageQueryDto> = new AuthorPageQueryDto(),
  ): Promise<AuthorPageView> {
    const authorObjectId = this.parseId(authorId, 'authorId');
    const hexId = authorObjectId.toHexString();
    const profiles = await this.resolveProfiles([hexId]);
    const author = profiles.get(hexId);
    if (
      !author ||
      author.status === UserStatus.DEACTIVATED ||
      !(await this.isRegularUserAccount(author))
    ) {
      throw this.authorNotFound();
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const itinerariesPage = query.itinerariesPage ?? 1;
    const itinerariesLimit = query.itinerariesLimit ?? 10;
    const [posts, itineraries] = await Promise.all([
      this.paginatePublishedPosts(
        { authorId: authorObjectId },
        { page, limit },
        profiles,
      ),
      this.itinerariesService.listPublicByAuthor(hexId, {
        page: itinerariesPage,
        limit: itinerariesLimit,
      }),
    ]);

    return {
      id: author.id,
      name: author.name,
      createdAt: author.createdAt,
      posts,
      itineraries,
    };
  }

  /**
   * Checks account role via `AccountsService` (`CTR-01`) so admin and
   * moderator accounts never expose an author page.
   */
  private async isRegularUserAccount(author: AccountProfile): Promise<boolean> {
    const trimmedName = author.name.trim();
    for (let page = 1; ; page += 1) {
      const accountsPage = await this.accountsService.listAccounts({
        page,
        limit: 50,
        ...(trimmedName !== '' ? { q: trimmedName } : {}),
        status: author.status,
      });
      const match = accountsPage.items.find((item) => item.id === author.id);
      if (match) {
        return match.role === UserRole.USER;
      }
      if (page >= accountsPage.totalPages || accountsPage.items.length === 0) {
        return false;
      }
    }
  }

  /**
   * BLG-08: lists paginated published posts matching the normalised tag,
   * excluding drafts, hidden posts and deactivated authors' posts.
   */
  async listByTag(
    tag: string,
    query: PaginationQueryDto = new PaginationQueryDto(),
  ): Promise<Paginated<PublishedPostView>> {
    const normalizedTag = typeof tag === 'string' ? normalizeTag(tag) : '';
    if (
      normalizedTag.length < MIN_TAG_LENGTH ||
      normalizedTag.length > MAX_TAG_LENGTH
    ) {
      throw this.invalidTag();
    }
    const listQuery = new ListPostsQueryDto();
    listQuery.page = query.page;
    listQuery.limit = query.limit;
    listQuery.tag = normalizedTag;
    return this.listPublished(listQuery);
  }

  /** BLG-03: lists the authenticated author's posts (draft and published), newest updated first. */
  async listMine(
    userId: string,
    query: PaginationQueryDto = new PaginationQueryDto(),
  ): Promise<Paginated<PostView>> {
    const authorId = this.parseId(userId, 'userId');
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const result = await paginate(
      this.postModel,
      { authorId },
      { page, limit },
      { sort: { updatedAt: -1 } },
    );
    return {
      ...result,
      items: result.items.map((post) => this.toView(post as PostRecord)),
    };
  }

  /**
   * BLG-02: loads a publicly visible published post with its resolved author
   * name. Throws 404 for missing, draft, hidden, or deactivated-author posts.
   */
  async getById(postId: string): Promise<PostDetailView> {
    const id = this.parseId(postId, 'postId');
    const { post, postAuthor } = await this.loadVisiblePublishedPost(id);
    return this.toPublishedView(post, postAuthor);
  }

  /**
   * BLG-05 / GEN-05: lists paginated visible comments on a published post in
   * chronological order (oldest first, `_id` as tie-breaker). Throws 404 for
   * missing, draft, hidden, or deactivated-author posts.
   */
  async listComments(
    postId: string,
    query: PaginationQueryDto = new PaginationQueryDto(),
  ): Promise<Paginated<CommentView>> {
    const id = this.parseId(postId, 'postId');
    await this.loadVisiblePublishedPost(id);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const result = await paginate(
      this.commentModel,
      { postId: id, isHidden: false },
      { page, limit },
      { sort: { createdAt: 1, _id: 1 } },
    );
    const profiles = await this.resolveProfiles(
      result.items.map((comment) => comment.authorId.toHexString()),
    );
    return {
      ...result,
      items: result.items.map((comment) =>
        this.toCommentView(
          comment as CommentRecord,
          profiles.get(comment.authorId.toHexString()),
        ),
      ),
    };
  }

  /**
   * BLG-05: adds a comment (1–500 chars trimmed) to a published post and
   * increments `commentCount` atomically in a transaction.
   */
  async createComment(
    postId: string,
    dto: CreateCommentDto,
    userId: string,
  ): Promise<CommentView> {
    const postObjectId = this.parseId(postId, 'postId');
    const authorId = this.parseId(userId, 'userId');
    const body = this.normalizeCommentBody(dto.body);

    let createdRecord: CommentRecord | undefined;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const post = await this.postModel
          .findOneAndUpdate(
            {
              _id: postObjectId,
              status: PostStatus.PUBLISHED,
              isHidden: false,
              authorDeactivated: false,
            },
            { $inc: { commentCount: 1 } },
            { session, returnDocument: 'after' },
          )
          .lean()
          .exec();
        if (!post) throw this.notFound();

        const [created] = await this.commentModel.create(
          [{ postId: postObjectId, authorId, body }],
          { session },
        );
        createdRecord = created.toObject() as CommentRecord;
      });
    } finally {
      await session.endSession();
    }

    return this.toCommentViewWithProfile(
      createdRecord!,
      authorId.toHexString(),
    );
  }

  /**
   * BLG-07: edits the authenticated author's own comment; throws 404 if
   * missing or owned by another user.
   */
  async updateComment(
    commentId: string,
    dto: UpdateCommentDto,
    userId: string,
  ): Promise<CommentView> {
    const id = this.parseId(commentId, 'commentId');
    const authorId = this.parseId(userId, 'userId');
    const body = this.normalizeCommentBody(dto.body);

    const updated = await this.commentModel
      .findOneAndUpdate(
        { _id: id, authorId },
        { $set: { body } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!updated) throw this.commentNotFound();

    return this.toCommentViewWithProfile(
      updated as CommentRecord,
      authorId.toHexString(),
    );
  }

  /**
   * BLG-07: deletes the authenticated author's own comment and decrements the
   * post's `commentCount` (when visible and > 0) atomically in a transaction.
   */
  async deleteComment(commentId: string, userId: string): Promise<void> {
    const id = this.parseId(commentId, 'commentId');
    const authorId = this.parseId(userId, 'userId');

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const deleted = await this.commentModel
          .findOneAndDelete({ _id: id, authorId }, { session })
          .lean()
          .exec();
        if (!deleted) throw this.commentNotFound();

        if (!deleted.isHidden) {
          await this.postModel
            .updateOne(
              { _id: deleted.postId, commentCount: { $gt: 0 } },
              { $inc: { commentCount: -1 } },
              { session },
            )
            .exec();
        }
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * BLG-06: likes a visible published post for the authenticated user
   * (idempotent via the `{ postId: 1, userId: 1 }` unique index).
   */
  async likePost(postId: string, userId: string): Promise<PostLikeView> {
    const postObjectId = this.parseId(postId, 'postId');
    const userObjectId = this.parseId(userId, 'userId');

    await this.loadVisiblePublishedPost(postObjectId);

    // Handle the unique-index insert outside a transaction because E11000 aborts a MongoDB transaction.
    let insertedLikeId: Types.ObjectId | undefined;
    try {
      const created = await this.likeModel.create({
        postId: postObjectId,
        userId: userObjectId,
      });
      insertedLikeId = created._id;
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        insertedLikeId = undefined;
      } else {
        throw error;
      }
    }

    if (insertedLikeId !== undefined) {
      const updated = await this.postModel
        .findOneAndUpdate(
          { _id: postObjectId },
          { $inc: { likeCount: 1 } },
          { returnDocument: 'after' },
        )
        .lean()
        .exec();
      if (!updated) {
        await this.likeModel.deleteOne({ _id: insertedLikeId }).exec();
        throw this.notFound();
      }
      return {
        postId: postObjectId.toHexString(),
        likeCount: Math.max(0, updated.likeCount),
        liked: true,
      };
    }

    const current = await this.postModel.findById(postObjectId).lean().exec();
    if (!current) throw this.notFound();
    return {
      postId: postObjectId.toHexString(),
      likeCount: Math.max(0, current.likeCount),
      liked: true,
    };
  }

  /**
   * BLG-06: removes the authenticated user's like from a visible published
   * post (idempotent; decrements `likeCount` only when a like was deleted).
   */
  async unlikePost(postId: string, userId: string): Promise<PostLikeView> {
    const postObjectId = this.parseId(postId, 'postId');
    const userObjectId = this.parseId(userId, 'userId');

    await this.loadVisiblePublishedPost(postObjectId);

    const deleted = await this.likeModel
      .findOneAndDelete({
        postId: postObjectId,
        userId: userObjectId,
      })
      .lean()
      .exec();

    if (deleted) {
      const updated = await this.postModel
        .findOneAndUpdate(
          { _id: postObjectId },
          { $inc: { likeCount: -1 } },
          { returnDocument: 'after' },
        )
        .lean()
        .exec();
      if (!updated) throw this.notFound();
      return {
        postId: postObjectId.toHexString(),
        likeCount: Math.max(0, updated.likeCount),
        liked: false,
      };
    }

    const current = await this.postModel.findById(postObjectId).lean().exec();
    if (!current) throw this.notFound();
    return {
      postId: postObjectId.toHexString(),
      likeCount: Math.max(0, current.likeCount),
      liked: false,
    };
  }

  /**
   * BLG-04 / BLG-08: updates the authenticated owner's post. Sets
   * `publishedAt` the first time the post is published; throws 404 if missing
   * or owned by someone else.
   */
  async update(
    postId: string,
    dto: UpdatePostDto,
    userId: string,
  ): Promise<PostView> {
    const id = this.parseId(postId, 'postId');
    const authorId = this.parseId(userId, 'userId');

    if (dto.body !== undefined) {
      this.assertNonBlankBody(dto.body);
    }
    const normalizedTags =
      dto.tags !== undefined ? this.prepareTags(dto.tags) : undefined;

    const existing = await this.postModel
      .findOne({ _id: id, authorId })
      .lean()
      .exec();
    if (!existing) throw this.notFound();

    const updates: {
      title?: string;
      body?: string;
      tags?: string[];
      status?: PostStatus;
      publishedAt?: Date;
    } = {};

    if (dto.title !== undefined) {
      updates.title = dto.title.trim();
    }
    if (dto.body !== undefined) {
      updates.body = dto.body;
    }
    if (normalizedTags !== undefined) {
      updates.tags = normalizedTags;
    }
    if (dto.status !== undefined) {
      updates.status = dto.status;
      if (dto.status === PostStatus.PUBLISHED && !existing.publishedAt) {
        updates.publishedAt = new Date();
      }
    }

    if (Object.keys(updates).length === 0) {
      return this.toView(existing as PostRecord);
    }

    const updated = await this.postModel
      .findOneAndUpdate(
        { _id: id, authorId },
        { $set: updates },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!updated) throw this.notFound();

    return this.toView(updated as PostRecord);
  }

  /**
   * BLG-04: deletes the authenticated owner's post along with its comments and
   * likes in one transaction; throws 404 if missing or owned by someone else.
   */
  async delete(postId: string, userId: string): Promise<void> {
    const id = this.parseId(postId, 'postId');
    const authorId = this.parseId(userId, 'userId');

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const deleted = await this.postModel
          .findOneAndDelete({ _id: id, authorId }, { session })
          .lean()
          .exec();
        if (!deleted) throw this.notFound();

        await this.commentModel.deleteMany({ postId: id }, { session }).exec();
        await this.likeModel.deleteMany({ postId: id }, { session }).exec();
      });
      // BLG-10 will delete stored post image files after the transaction commits.
    } finally {
      await session.endSession();
    }
  }

  /** ACC-12: hides all posts of a deactivated author on future reads (idempotent). */
  @OnEvent(Events.UserDeactivated)
  async onUserDeactivated(
    payload: PayloadOf<typeof Events.UserDeactivated>,
  ): Promise<void> {
    await this.setAuthorDeactivated(payload.userId, true);
  }

  /** ACC-12: restores visibility for posts of a reactivated author (idempotent). */
  @OnEvent(Events.UserReactivated)
  async onUserReactivated(
    payload: PayloadOf<typeof Events.UserReactivated>,
  ): Promise<void> {
    await this.setAuthorDeactivated(payload.userId, false);
  }

  private async setAuthorDeactivated(
    userId: string,
    authorDeactivated: boolean,
  ): Promise<void> {
    if (typeof userId !== 'string' || !OBJECT_ID_HEX_RE.test(userId)) {
      return;
    }
    await this.postModel
      .updateMany(
        {
          authorId: new Types.ObjectId(userId),
          authorDeactivated: !authorDeactivated,
        },
        { $set: { authorDeactivated } },
      )
      .exec();
  }

  private async resolveProfiles(
    userIds: string[],
  ): Promise<Map<string, AccountProfile>> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return new Map();

    const profiles = await this.accountsService.getProfiles(uniqueIds);
    return new Map(profiles.map((profile) => [profile.id, profile]));
  }

  private async loadVisiblePublishedPost(id: Types.ObjectId): Promise<{
    post: PostRecord;
    postAuthor: AccountProfile | undefined;
  }> {
    const post = await this.postModel
      .findOne({
        _id: id,
        status: PostStatus.PUBLISHED,
        isHidden: false,
        authorDeactivated: false,
      })
      .lean()
      .exec();
    if (!post) throw this.notFound();

    const profiles = await this.resolveProfiles([post.authorId.toHexString()]);
    const postAuthor = profiles.get(post.authorId.toHexString());
    if (postAuthor?.status === UserStatus.DEACTIVATED) {
      throw this.notFound();
    }

    return {
      post: post as PostRecord,
      postAuthor,
    };
  }

  private async toCommentViewWithProfile(
    comment: CommentRecord,
    authorId: string,
  ): Promise<CommentView> {
    const profiles = await this.resolveProfiles([authorId]);
    return this.toCommentView(comment, profiles.get(authorId));
  }

  private normalizeCommentBody(body: string): string {
    if (typeof body !== 'string') {
      throw this.invalidCommentBody();
    }
    const trimmed = body.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      throw this.invalidCommentBody();
    }
    return trimmed;
  }

  private invalidCommentBody(): BadRequestException {
    return new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [
        {
          field: 'body',
          message: 'body must be between 1 and 500 characters',
        },
      ],
    });
  }

  private assertNonBlankBody(body: string): void {
    if (!/\S/.test(body)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field: 'body', message: 'body must not be blank' }],
      });
    }
  }

  private prepareTags(tags: string[]): string[] {
    if (
      !Array.isArray(tags) ||
      !tags.every((item): item is string => typeof item === 'string')
    ) {
      throw this.invalidTags('tags must be an array of strings');
    }
    const normalized = normalizeTags(tags);
    if (normalized.length > MAX_TAGS_PER_POST) {
      throw this.invalidTags(
        `tags must contain no more than ${MAX_TAGS_PER_POST} items`,
      );
    }
    if (
      normalized.some(
        (tag) => tag.length < MIN_TAG_LENGTH || tag.length > MAX_TAG_LENGTH,
      )
    ) {
      throw this.invalidTags(
        `each tag must be between ${MIN_TAG_LENGTH} and ${MAX_TAG_LENGTH} characters`,
      );
    }
    return normalized;
  }

  private invalidTags(message: string): BadRequestException {
    return new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [{ field: 'tags', message }],
    });
  }

  private invalidTag(): BadRequestException {
    return new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [
        {
          field: 'tag',
          message: `tag must be between ${MIN_TAG_LENGTH} and ${MAX_TAG_LENGTH} characters`,
        },
      ],
    });
  }

  private parseId(value: string, field: string): Types.ObjectId {
    if (typeof value !== 'string' || !OBJECT_ID_HEX_RE.test(value)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: `Invalid ${field}`,
        details: [{ field, message: 'must be a valid ObjectId' }],
      });
    }
    return new Types.ObjectId(value);
  }

  private async paginatePublishedPosts(
    extraFilter: QueryFilter<StoredPost>,
    { page, limit }: { page: number; limit: number },
    knownProfiles?: Map<string, AccountProfile>,
  ): Promise<Paginated<PublishedPostView>> {
    const filter: QueryFilter<StoredPost> = {
      status: PostStatus.PUBLISHED,
      isHidden: false,
      authorDeactivated: false,
      ...extraFilter,
    };
    const result = await paginate(
      this.postModel,
      filter,
      { page, limit },
      { sort: { publishedAt: -1, _id: -1 } },
    );
    const profiles =
      knownProfiles ??
      (await this.resolveProfiles(
        result.items.map((post) => post.authorId.toHexString()),
      ));
    return {
      ...result,
      items: result.items.map((post) =>
        this.toPublishedView(
          post as PostRecord,
          profiles.get(post.authorId.toHexString()),
        ),
      ),
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Post not found',
    });
  }

  private authorNotFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Author not found',
    });
  }

  private commentNotFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Comment not found',
    });
  }

  private toView(post: PostRecord): PostView {
    return {
      _id: post._id.toHexString(),
      authorId: post.authorId.toHexString(),
      title: post.title,
      body: post.body,
      tags: [...post.tags],
      images: post.images.map((image) => ({
        _id: image._id.toHexString(),
        key: image.key,
      })),
      status: post.status,
      ...(post.publishedAt !== undefined
        ? { publishedAt: post.publishedAt }
        : {}),
      likeCount: Math.max(0, post.likeCount),
      commentCount: post.commentCount,
      isHidden: post.isHidden,
      authorDeactivated: post.authorDeactivated,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }

  private toPublishedView(
    post: PostRecord,
    profile?: AccountProfile,
  ): PublishedPostView {
    return {
      ...this.toView(post),
      authorName: profile?.name ?? null,
    };
  }

  private toCommentView(
    comment: CommentRecord,
    profile?: AccountProfile,
  ): CommentView {
    return {
      _id: comment._id.toHexString(),
      postId: comment.postId.toHexString(),
      authorId: comment.authorId.toHexString(),
      authorName:
        profile?.status === UserStatus.DEACTIVATED
          ? DELETED_USER_NAME
          : (profile?.name ?? null),
      body: comment.body,
      isHidden: comment.isHidden,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }
}
