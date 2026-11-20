import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CabinClass } from '../../../common/database/cabin-class.js';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

export type ItineraryTripType = 'one_way' | 'round_trip';

/**
 * Query parameters for `GET /api/itineraries/:id/flights` (ITN-26). The
 * destination and dates come from the itinerary; the caller supplies the
 * origin airport and the trip type.
 */
export class ItineraryFlightsQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: 'CAI', description: 'Departure airport code (IATA)' })
  @IsString()
  origin!: string;

  @ApiPropertyOptional({
    enum: ['one_way', 'round_trip'],
    default: 'one_way',
  })
  @IsOptional()
  @IsIn(['one_way', 'round_trip'])
  tripType: ItineraryTripType = 'one_way';

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  adults: number = 1;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  children: number = 0;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  infants: number = 0;

  @ApiPropertyOptional({ enum: Object.values(CabinClass) })
  @IsOptional()
  @IsIn(Object.values(CabinClass))
  cabinClass?: CabinClass;
}
