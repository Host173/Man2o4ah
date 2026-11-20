import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/** Query parameters for `GET /api/itineraries/public/search` (ITN-20, ITN-21). */
export class PublicSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive keyword on title, country and city',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minDays?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxDays?: number;

  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiPropertyOptional({ example: 'cairo' })
  @IsOptional()
  @IsString()
  cityId?: string;
}
