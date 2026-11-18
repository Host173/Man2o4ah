import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type {
  ActivityCostView,
  ActivityImageView,
  ActivityView,
  BudgetEntryView,
  CityGroupView,
  ItineraryDayView,
  ItineraryDetailView,
  ItinerarySummary,
  TransportCostView,
} from '../itineraries.types.js';
import {
  BudgetCategory,
  ItineraryVisibility,
  TransportMode,
} from '../schemas/itinerary.schema.js';

/** Swagger response model for an activity image (GEN-08). */
export class ActivityImageResponseDto implements ActivityImageView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f601' })
  _id!: string;

  @ApiProperty({ example: 'cairo-123.jpg' })
  key!: string;
}

/** Swagger response model for an activity's cost (ITN-14). */
export class ActivityCostResponseDto implements ActivityCostView {
  @ApiProperty({ example: 2000 })
  amountMinor!: number;

  @ApiProperty({ example: 'EGP' })
  currency!: string;
}

/** Swagger response model for an itinerary activity (ITN-10). */
export class ActivityResponseDto implements ActivityView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f605' })
  _id!: string;

  @ApiProperty({ example: 'Pyramids of Giza' })
  name!: string;

  @ApiPropertyOptional({ example: 'Guided tour' })
  description?: string;

  @ApiPropertyOptional({ example: '09:30' })
  time?: string;

  @ApiPropertyOptional({ type: ActivityCostResponseDto })
  cost?: ActivityCostResponseDto;

  @ApiProperty({ type: [ActivityImageResponseDto] })
  images!: ActivityImageResponseDto[];

  @ApiPropertyOptional({ example: 'att-1' })
  attractionId?: string;
}

/** Swagger response model for an itinerary budget entry (ITN-14). */
export class BudgetEntryResponseDto implements BudgetEntryView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f606' })
  _id!: string;

  @ApiProperty({
    enum: Object.values(BudgetCategory),
    example: BudgetCategory.FOOD,
  })
  category!: BudgetCategory;

  @ApiProperty({ example: 1500 })
  amountMinor!: number;

  @ApiProperty({ example: 'EGP' })
  currency!: string;

  @ApiPropertyOptional({ example: 'Lunch' })
  note?: string;
}

/** Swagger response model for one itinerary day (ITN-05). */
export class ItineraryDayResponseDto implements ItineraryDayView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f604' })
  _id!: string;

  @ApiProperty({ example: 1 })
  dayNumber!: number;

  @ApiProperty({ type: String, format: 'date', example: '2027-04-01' })
  date!: string;

  @ApiProperty({ example: 'cairo' })
  cityId!: string;

  @ApiPropertyOptional({ example: 'Arrival day' })
  notes?: string;

  @ApiProperty({ type: [ActivityResponseDto] })
  activities!: ActivityResponseDto[];

  @ApiProperty({ type: [BudgetEntryResponseDto] })
  budgetEntries!: BudgetEntryResponseDto[];
}

/** Swagger response model for a group of consecutive same-city days (ITN-09). */
export class CityGroupResponseDto implements CityGroupView {
  @ApiProperty({ example: 'cairo' })
  cityId!: string;

  @ApiProperty({ example: 1 })
  fromDay!: number;

  @ApiProperty({ example: 2 })
  toDay!: number;

  @ApiProperty({ example: 2 })
  dayCount!: number;

  @ApiProperty({ type: String, format: 'date', example: '2027-04-01' })
  checkIn!: string;

  @ApiProperty({ type: String, format: 'date', example: '2027-04-03' })
  checkOut!: string;
}

/** Swagger response model for an intercity transport cost (ITN-16). */
export class TransportCostResponseDto implements TransportCostView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f607' })
  _id!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f604' })
  dayId!: string;

  @ApiProperty({
    enum: Object.values(TransportMode),
    example: TransportMode.TRAIN,
  })
  mode!: TransportMode;

  @ApiProperty({ example: 'cairo' })
  fromCityId!: string;

  @ApiProperty({ example: 'luxor' })
  toCityId!: string;

  @ApiProperty({ example: 30000 })
  amountMinor!: number;

  @ApiProperty({ example: 'EGP' })
  currency!: string;
}

/** Swagger response model for an itinerary in the owner's list (ITN-03). */
export class ItineraryResponseDto implements ItinerarySummary {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f602' })
  _id!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f603' })
  ownerId!: string;

  @ApiProperty({ example: 'Egypt in a week' })
  title!: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countryCodes!: string[];

  @ApiProperty({ type: String, format: 'date', example: '2027-04-01' })
  startDate!: string;

  @ApiProperty({ example: 0, description: '`days.length` (ITN-05).' })
  dayCount!: number;

  @ApiProperty({
    enum: Object.values(ItineraryVisibility),
    example: ItineraryVisibility.PRIVATE,
  })
  visibility!: ItineraryVisibility;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-17T12:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-17T12:00:00.000Z',
  })
  updatedAt!: Date;
}

/** Swagger response model for a paginated list of own itineraries (ITN-03). */
export class PaginatedItinerariesResponseDto implements Paginated<ItineraryResponseDto> {
  @ApiProperty({ type: [ItineraryResponseDto] })
  items!: ItineraryResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

/** Swagger response model for a clone's attribution (ITN-21). */
export class ClonedFromResponseDto {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f602' })
  itineraryId!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f603' })
  authorId!: string;
}

/** Swagger response model for a full itinerary (ITN-03). */
export class ItineraryDetailResponseDto
  extends ItineraryResponseDto
  implements ItineraryDetailView
{
  @ApiProperty({ type: [ItineraryDayResponseDto] })
  days!: ItineraryDayResponseDto[];

  @ApiProperty({ type: [CityGroupResponseDto] })
  cityGroups!: CityGroupResponseDto[];

  @ApiProperty({ type: [TransportCostResponseDto] })
  transportCosts!: TransportCostResponseDto[];

  @ApiProperty({ example: false })
  isHidden!: boolean;

  @ApiProperty({ example: false })
  authorDeactivated!: boolean;

  @ApiPropertyOptional({ type: ClonedFromResponseDto })
  clonedFrom?: ClonedFromResponseDto;
}
