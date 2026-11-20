import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { toDateOnly } from '../../../common/dates/date-only.js';
import type { HotelSearchQuery } from '../hotels.types.js';
import { StayDatesQueryDto } from './stay-dates-query.dto.js';

export class SearchHotelsQueryDto extends StayDatesQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'Supply cityId or countryCode; supplying both matches both',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cityId?: string;

  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

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

  toSearchQuery(): HotelSearchQuery {
    return {
      cityId: this.cityId,
      countryCode: this.countryCode,
      checkIn: toDateOnly(this.checkIn),
      checkOut: toDateOnly(this.checkOut),
      guests: this.guests,
      rooms: this.rooms,
      minPriceMinor: this.minPrice,
      maxPriceMinor: this.maxPrice,
      minRating: this.minRating,
      sortBy: this.sortBy,
      sortOrder: this.sortOrder,
      page: this.page,
      limit: this.limit,
    };
  }
}
