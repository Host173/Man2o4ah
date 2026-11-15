import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { PostImageView, PostView } from '../blog.types.js';
import { PostStatus } from '../schemas/post.schema.js';

/** Swagger response model for an embedded image reference on a post. */
export class PostImageResponseDto implements PostImageView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f601' })
  _id!: string;

  @ApiProperty({ example: 'cairo-123.jpg' })
  key!: string;
}

/** Swagger response model for a blog post (`BLG-01`, `BLG-03`, `BLG-04`). */
export class PostResponseDto implements PostView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f602' })
  _id!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f603' })
  authorId!: string;

  @ApiProperty({ example: 'Three days in Cairo' })
  title!: string;

  @ApiProperty({ example: 'Start at the pyramids early in the morning.' })
  body!: string;

  @ApiProperty({ type: [String], example: [] })
  tags!: string[];

  @ApiProperty({ type: [PostImageResponseDto] })
  images!: PostImageResponseDto[];

  @ApiProperty({ enum: Object.values(PostStatus), example: PostStatus.DRAFT })
  status!: PostStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-15T12:00:00.000Z',
  })
  publishedAt?: Date;

  @ApiProperty({ example: 0 })
  likeCount!: number;

  @ApiProperty({ example: 0 })
  commentCount!: number;

  @ApiProperty({ example: false })
  isHidden!: boolean;

  @ApiProperty({ example: false })
  authorDeactivated!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T12:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T12:00:00.000Z',
  })
  updatedAt!: Date;
}

/** Swagger response model for a paginated list of own blog posts (`BLG-03`). */
export class PaginatedPostResponseDto implements Paginated<PostResponseDto> {
  @ApiProperty({ type: [PostResponseDto] })
  items!: PostResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
