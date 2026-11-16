import type { PostStatus } from './schemas/post.schema.js';

/** Plain view of an image reference on a post (GEN-08). */
export interface PostImageView {
  _id: string;
  key: string;
}

/**
 * Plain view of a blog post returned by `BlogService` and HTTP endpoints
 * (BLG-01, BLG-03, BLG-04; api-contract.md §3).
 */
export interface PostView {
  _id: string;
  authorId: string;
  title: string;
  body: string;
  tags: string[];
  images: PostImageView[];
  status: PostStatus;
  publishedAt?: Date;
  likeCount: number;
  commentCount: number;
  isHidden: boolean;
  authorDeactivated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Plain view of a published blog post including the resolved author name
 * (`BLG-02`).
 */
export interface PublishedPostView extends PostView {
  authorName: string | null;
}

/**
 * Plain view of a visible comment shown on the post page (`BLG-02`).
 * Deactivated comment authors resolve to `'Deleted user'` (`ACC-12`).
 */
export interface CommentView {
  _id: string;
  postId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Full post page view including author name and visible chronological comments
 * (`BLG-02`).
 */
export interface PostDetailView extends PublishedPostView {
  comments: CommentView[];
}
