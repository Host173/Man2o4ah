import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

function normalizeTagQuery(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

/** Query parameters for browsing published blog posts (`BLG-02`). */
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
}
