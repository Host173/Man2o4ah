import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { paginate } from '../../common/pagination/paginate.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import type { PostView } from './blog.types.js';
import type { CreatePostDto } from './dto/create-post.dto.js';
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

const OBJECT_ID_HEX_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Travel blog post workflows (BLG-01, BLG-03, BLG-04).
 * Other blog endpoints and cross-module listeners ship in later Sprint 2 tickets.
 */
@Injectable()
export class BlogService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<StoredPost>,
    @InjectModel(Comment.name) private readonly commentModel: Model<Comment>,
    @InjectModel(Like.name) private readonly likeModel: Model<Like>,
  ) {}

  /** BLG-01: creates a post as draft or published owned by the authenticated user. */
  async create(dto: CreatePostDto, userId: string): Promise<PostView> {
    const authorId = this.parseId(userId, 'userId');
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
   * likes; throws 404 if missing or owned by someone else.
   */
  async delete(postId: string, userId: string): Promise<void> {
    const id = this.parseId(postId, 'postId');
    const authorId = this.parseId(userId, 'userId');

    const deleted = await this.postModel
      .findOneAndDelete({ _id: id, authorId })
      .lean()
      .exec();
    if (!deleted) throw this.notFound();

    await Promise.all([
      this.commentModel.deleteMany({ postId: id }).exec(),
      this.likeModel.deleteMany({ postId: id }).exec(),
    ]);
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
}
