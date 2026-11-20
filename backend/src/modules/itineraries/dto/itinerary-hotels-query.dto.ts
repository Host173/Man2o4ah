import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for `GET /api/itineraries/:id/hotels` (ITN-25): the city
 * group to search for, the guest and room counts, optional filters and
 * pagination. The city, check-in and check-out dates come from the itinerary.
 */
export class ItineraryHotelsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description:
      'Zero-based index into the itinerary city groups (cityGroups array).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  groupIndex!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  guests!: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rooms: number = 1;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    description:
      'Inclusive minimum cheapest qualifying nightly price in USD cents',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    description:
      'Inclusive maximum cheapest qualifying nightly price in USD cents',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Minimum average guest rating; excludes unrated hotels',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ enum: ['price', 'rating'] })
  @IsOptional()
  @IsIn(['price', 'rating'])
  sortBy?: 'price' | 'rating';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'asc',
    description: 'Unrated hotels sort last in either direction',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
