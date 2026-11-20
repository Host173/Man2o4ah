import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { normalizeTag } from '../blog-tags.js';

export const MAX_SEARCH_QUERY_LENGTH = 150;

function normalizeTagQuery(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = normalizeTag(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSearchQuery(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Query parameters for browsing and searching published blog posts (`BLG-02`, `BLG-09`). */
export class ListPostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter published posts by normalised tag (trimmed, lowercased)',
    example: 'egypt',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeTagQuery(value))
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    description:
      'Search published posts by keyword in title, tags, or author name (BLG-09)',
    maxLength: MAX_SEARCH_QUERY_LENGTH,
    example: 'cairo',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeSearchQuery(value))
  @IsString()
  @MaxLength(MAX_SEARCH_QUERY_LENGTH)
  q?: string;
}
