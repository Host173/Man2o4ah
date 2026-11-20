import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { CabinClass } from '../../../common/database/cabin-class.js';
import type { FlightSortBy, SearchFlightsBase } from '../flights.types.js';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SearchFlightsDto implements SearchFlightsBase {
  @ApiProperty({ example: 'CAI' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  from!: string;

  @ApiProperty({ example: 'DXB' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  to!: string;

  @ApiProperty({ example: '2027-03-14', pattern: 'YYYY-MM-DD' })
  @IsString()
  @Matches(LOCAL_DATE)
  date!: string;

  @ApiProperty({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  adults: number = 1;

  @ApiProperty({ minimum: 0, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  children: number = 0;

  @ApiProperty({ minimum: 0, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  infants: number = 0;

  @ApiPropertyOptional({ enum: Object.values(CabinClass) })
  @IsOptional()
  @IsEnum(CabinClass)
  cabinClass?: CabinClass;

  @ApiPropertyOptional({ type: 'integer', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  minPriceMinor?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxPriceMinor?: number;

  @ApiProperty({
    enum: ['price', 'duration', 'departure'],
    default: 'departure',
  })
  @IsEnum(['price', 'duration', 'departure'])
  sortBy: FlightSortBy = 'departure';

  @ApiPropertyOptional({ example: '2027-03-20', pattern: 'YYYY-MM-DD' })
  @ValidateIf((dto) => dto.returnDate !== undefined)
  @IsString()
  @Matches(LOCAL_DATE)
  returnDate?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
