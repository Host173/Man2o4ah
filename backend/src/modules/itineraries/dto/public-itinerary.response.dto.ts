import { ApiProperty } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { PublicItinerarySummary } from '../itineraries.types.js';

/** Swagger response model for a public itinerary summary (ITN-20). */
export class PublicItinerarySummaryResponseDto implements PublicItinerarySummary {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f610' })
  id!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f603' })
  ownerId!: string;

  @ApiProperty({ example: 'Classic Nile & Red Sea' })
  title!: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countryCodes!: string[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-12-01T00:00:00.000Z',
  })
  startDate!: Date;

  @ApiProperty({ example: 5 })
  dayCount!: number;

  @ApiProperty({ type: [String], example: ['cairo', 'luxor'] })
  cityIds!: string[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T12:00:00.000Z',
  })
  updatedAt!: Date;
}

/** Paginated public search results (ITN-20). */
export class PaginatedPublicItinerariesResponseDto implements Paginated<PublicItinerarySummaryResponseDto> {
  @ApiProperty({ type: [PublicItinerarySummaryResponseDto] })
  items!: PublicItinerarySummaryResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
