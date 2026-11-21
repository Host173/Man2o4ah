import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type {
  PublicItineraryDetailView,
  PublicItinerarySummary,
} from '../itineraries.types.js';
import { BudgetSummaryResponseDto } from './budget-summary.response.dto.js';
import {
  CityGroupResponseDto,
  ClonedFromResponseDto,
  ItineraryDayResponseDto,
  TransportCostResponseDto,
} from './itinerary.response.dto.js';

/** Swagger response model for a public itinerary summary (ITN-20). */
export class PublicItinerarySearchItemResponseDto implements Omit<
  PublicItinerarySummary,
  'id' | 'startDate'
> {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f610' })
  _id!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f603' })
  ownerId!: string;

  @ApiProperty({ example: 'Classic Nile & Red Sea' })
  title!: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countryCodes!: string[];

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-12-01',
  })
  startDate!: string;

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
export class PaginatedPublicItinerarySearchResponseDto implements Paginated<PublicItinerarySearchItemResponseDto> {
  @ApiProperty({ type: [PublicItinerarySearchItemResponseDto] })
  items!: PublicItinerarySearchItemResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

/** Swagger response model for the read-only public itinerary page (ITN-21). */
export class PublicItineraryDetailResponseDto implements PublicItineraryDetailView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f610' })
  _id!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f603' })
  ownerId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Aisha Rawahi',
    description: 'The author name; null when the account cannot be found.',
  })
  authorName!: string | null;

  @ApiProperty({ example: 'Classic Nile & Red Sea' })
  title!: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countryCodes!: string[];

  @ApiProperty({ type: String, format: 'date', example: '2026-12-01' })
  startDate!: string;

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

  @ApiProperty({ type: [ItineraryDayResponseDto] })
  days!: ItineraryDayResponseDto[];

  @ApiProperty({ type: [CityGroupResponseDto] })
  cityGroups!: CityGroupResponseDto[];

  @ApiProperty({ type: [TransportCostResponseDto] })
  transportCosts!: TransportCostResponseDto[];

  @ApiPropertyOptional({ type: ClonedFromResponseDto })
  clonedFrom?: ClonedFromResponseDto;

  @ApiProperty({
    type: BudgetSummaryResponseDto,
    nullable: true,
    description:
      'In the platform currency; null when exchange rates are unavailable.',
  })
  budget!: BudgetSummaryResponseDto | null;
}
