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
import { UserStatus } from '../accounts/schemas/user.schema.js';
import type {
  CommentView,
  PostDetailView,
  PostView,
  PublishedPostView,
} from './blog.types.js';
import type { CreatePostDto } from './dto/create-post.dto.js';
import { ListPostsQueryDto } from './dto/list-posts-query.dto.js';
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
 * Travel blog post workflows (BLG-01, BLG-02, BLG-03, BLG-04, ACC-12).
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
  ) {}

  /** BLG-01: creates a post as draft or published owned by the authenticated user. */
  async create(dto: CreatePostDto, userId: string): Promise<PostView> {
    const authorId = this.parseId(userId, 'userId');
    this.assertNonBlankBody(dto.body);
    const created = await this.postModel.create({
      authorId,
      title: dto.title.trim(),
      body: dto.body,
      status: dto.status,
      ...(dto.status === PostStatus.PUBLISHED
        ? { publishedAt: new Date() }
        : {}),
    });
    return this.toView(created.toObject() as PostRecord);
  }

  /**
   * BLG-02: lists paginated published posts (newest `publishedAt` first),
   * optionally filtered by tag, excluding drafts, hidden posts and
   * deactivated authors' posts.
   */
  async listPublished(
    query: ListPostsQueryDto = new ListPostsQueryDto(),
  ): Promise<Paginated<PublishedPostView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter: QueryFilter<StoredPost> = {
      status: PostStatus.PUBLISHED,
      isHidden: false,
      authorDeactivated: false,
      ...(query.tag ? { tags: query.tag } : {}),
    };
    const result = await paginate(
      this.postModel,
      filter,
      { page, limit },
      { sort: { publishedAt: -1, _id: -1 } },
    );
    const profiles = await this.resolveProfiles(
      result.items.map((post) => post.authorId.toHexString()),
    );
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
   * name and visible chronological comments. Throws 404 for missing, draft,
   * hidden, or deactivated-author posts.
   */
  async getById(postId: string): Promise<PostDetailView> {
    const id = this.parseId(postId, 'postId');
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

    const comments = await this.commentModel
      .find({ postId: id, isHidden: false })
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();

    const profiles = await this.resolveProfiles([
      post.authorId.toHexString(),
      ...comments.map((comment) => comment.authorId.toHexString()),
    ]);
    const postAuthor = profiles.get(post.authorId.toHexString());
    if (postAuthor?.status === UserStatus.DEACTIVATED) {
      throw this.notFound();
    }

    return {
      ...this.toPublishedView(post as PostRecord, postAuthor),
      comments: comments.map((comment) =>
        this.toCommentView(
          comment as CommentRecord,
          profiles.get(comment.authorId.toHexString()),
        ),
      ),
    };
  }

  /**
   * BLG-04: updates the authenticated owner's post. Sets `publishedAt` the first
   * time the post is published; throws 404 if missing or owned by someone else.
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

    const existing = await this.postModel
      .findOne({ _id: id, authorId })
      .lean()
      .exec();
    if (!existing) throw this.notFound();

    const updates: {
      title?: string;
      body?: string;
      status?: PostStatus;
      publishedAt?: Date;
    } = {};

    if (dto.title !== undefined) {
      updates.title = dto.title.trim();
    }
    if (dto.body !== undefined) {
      updates.body = dto.body;
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

  private assertNonBlankBody(body: string): void {
    if (!/\S/.test(body)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field: 'body', message: 'body must not be blank' }],
      });
    }
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

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Post not found',
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
      likeCount: post.likeCount,
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
