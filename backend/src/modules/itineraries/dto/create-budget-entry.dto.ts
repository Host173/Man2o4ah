import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BudgetCategory } from '../schemas/itinerary.schema.js';
import { MAX_AMOUNT_MINOR } from '../../../common/money/money.js';

/** ITN-14: a non-negative budget amount for one day and category. */
export class CreateBudgetEntryDto {
  @ApiProperty({
    enum: Object.values(BudgetCategory),
    example: BudgetCategory.FOOD,
  })
  @IsEnum(BudgetCategory)
  category!: BudgetCategory;

  @ApiProperty({ example: 1500, minimum: 0, maximum: MAX_AMOUNT_MINOR })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_MINOR)
  amountMinor!: number;

  @ApiProperty({ example: 'EGP' })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiPropertyOptional({ example: 'Lunch', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
