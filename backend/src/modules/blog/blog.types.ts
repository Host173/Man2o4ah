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
