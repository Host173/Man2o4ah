import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

export class StayDatesQueryDto extends PaginationQueryDto {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-12-01',
    description: 'First night, inclusive; cannot be before today in UTC',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  checkIn!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-12-03',
    description: 'Checkout date, exclusive; must follow checkIn',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  checkOut!: string;
}
