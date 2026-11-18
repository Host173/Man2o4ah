import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for `GET /api/authors/:id` (`BLG-12`, `GEN-05`):
 * `page`/`limit` paginate posts, while `itinerariesPage`/`itinerariesLimit`
 * paginate public itineraries independently with the same validation bounds.
 */
export class AuthorPageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itinerariesPage = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  itinerariesLimit = 10;
}
