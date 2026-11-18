import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/** Trims a query string (and upper-cases a code); an empty one counts as not sent. */
const trimmed = (upper = false) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const text = upper ? value.trim().toUpperCase() : value.trim();
    return text || undefined;
  });

/** `page`, `limit` and an optional keyword `q` (case-insensitive "contains"). */
export class SearchReferenceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Part of the name', example: 'cai' })
  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ListCitiesQueryDto extends SearchReferenceQueryDto {
  @ApiPropertyOptional({
    description: 'Country code (any case)',
    example: 'EG',
  })
  @IsOptional()
  @trimmed(true)
  @IsString()
  @MaxLength(10)
  countryCode?: string;
}

/** `q` matches the IATA code or the airport name (FLT-02). */
export class ListAirportsQueryDto extends ListCitiesQueryDto {
  @ApiPropertyOptional({ example: 'cairo' })
  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(100)
  cityId?: string;
}

export class ListAttractionsQueryDto extends SearchReferenceQueryDto {
  @ApiPropertyOptional({ example: 'cairo' })
  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(100)
  cityId?: string;
}
