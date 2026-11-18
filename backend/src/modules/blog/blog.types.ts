import type { Paginated } from '../../common/pagination/paginated.js';
import type { PublicItinerarySummary } from '../itineraries/itineraries.types.js';
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
 * Plain view of a visible comment on a blog post (`BLG-02`, `BLG-05`, `BLG-07`).
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
 * Public post page view (`BLG-02`).
 * Comments are loaded separately via paginated `GET /api/posts/:id/comments` (`BLG-05`, `GEN-05`).
 */
export type PostDetailView = PublishedPostView;

/** Plain view returned after liking or unliking a post (`BLG-06`). */
export interface PostLikeView {
  postId: string;
  likeCount: number;
  liked: boolean;
/**
 * Public author profile page view (`BLG-12`).
 * Exposes only public author fields (`id`, `name`, `createdAt`), paginated
 * published posts, and paginated public itineraries (`CTR-06`).
 */
export interface AuthorPageView {
  id: string;
  name: string;
  createdAt: Date;
  posts: Paginated<PublishedPostView>;
  itineraries: Paginated<PublicItinerarySummary>;
}
