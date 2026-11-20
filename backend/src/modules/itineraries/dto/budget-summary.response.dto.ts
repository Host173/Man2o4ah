import { ApiProperty } from '@nestjs/swagger';
import type {
  BudgetCategoryTotals,
  BudgetCityGroupSummary,
  BudgetDaySummary,
  BudgetSummaryView,
  MoneyView,
} from '../itineraries.types.js';

/** ITN-14/18: an amount in integer minor units of `currency`. */
export class MoneyResponseDto implements MoneyView {
  @ApiProperty({ example: 12550, description: 'Integer minor units.' })
  amountMinor!: number;

  @ApiProperty({ example: 'EGP' })
  currency!: string;
}

export class BudgetCategoryTotalsDto implements BudgetCategoryTotals {
  @ApiProperty({ type: MoneyResponseDto })
  food!: MoneyResponseDto;

  @ApiProperty({ type: MoneyResponseDto })
  accommodation!: MoneyResponseDto;

  @ApiProperty({ type: MoneyResponseDto })
  in_city_transport!: MoneyResponseDto;

  @ApiProperty({ type: MoneyResponseDto })
  activities!: MoneyResponseDto;

  @ApiProperty({ type: MoneyResponseDto })
  intercity_transport!: MoneyResponseDto;
}

/** ITN-14: one day's converted totals, including activity and transport costs. */
export class BudgetDaySummaryResponseDto implements BudgetDaySummary {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f604' })
  dayId!: string;

  @ApiProperty({ example: 1 })
  dayNumber!: number;

  @ApiProperty({ type: String, format: 'date', example: '2027-04-01' })
  date!: string;

  @ApiProperty({ example: 'cairo' })
  cityId!: string;

  @ApiProperty({ type: MoneyResponseDto })
  total!: MoneyResponseDto;

  @ApiProperty({ type: BudgetCategoryTotalsDto })
  byCategory!: BudgetCategoryTotalsDto;
}

/** ITN-14: a consecutive same-city group's converted subtotal. */
export class BudgetCityGroupSummaryResponseDto implements BudgetCityGroupSummary {
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

  @ApiProperty({ type: MoneyResponseDto })
  total!: MoneyResponseDto;
}

/** ITN-14/18: every amount converted to the viewer's preferred currency. */
export class BudgetSummaryResponseDto implements BudgetSummaryView {
  @ApiProperty({
    example: 'EGP',
    description: "The viewer's ACC-09 preferred currency.",
  })
  displayCurrency!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-11-01',
    description: 'UTC date of the cached exchange rates used.',
  })
  rateDate!: string;

  @ApiProperty({ type: MoneyResponseDto })
  total!: MoneyResponseDto;

  @ApiProperty({ type: BudgetCategoryTotalsDto })
  byCategory!: BudgetCategoryTotalsDto;

  @ApiProperty({ type: [BudgetDaySummaryResponseDto] })
  byDay!: BudgetDaySummaryResponseDto[];

  @ApiProperty({ type: [BudgetCityGroupSummaryResponseDto] })
  byCityGroup!: BudgetCityGroupSummaryResponseDto[];
}
