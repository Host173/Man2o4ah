import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { ReportView } from '../moderation.types.js';
import { ReportStatus, ReportTargetType } from '../schemas/report.schema.js';

/** Swagger response model for a created moderation report (`GEN-09`). */
export class ReportResponseDto implements ReportView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f620' })
  _id!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f601' })
  reporterId!: string;

  @ApiProperty({
    enum: Object.values(ReportTargetType),
    example: ReportTargetType.POST,
  })
  targetType!: ReportTargetType;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f610' })
  targetId!: string;

  @ApiProperty({ example: 'Contains spam links unrelated to travel.' })
  reason!: string;

  @ApiProperty({
    enum: Object.values(ReportStatus),
    example: ReportStatus.OPEN,
  })
  status!: ReportStatus;

  @ApiPropertyOptional({ example: '6736f0b2c5a1b2c3d4e5f699' })
  resolvedBy?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-18T10:00:00.000Z',
  })
  resolvedAt?: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-18T09:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-18T09:00:00.000Z',
  })
  updatedAt!: Date;
}

/** Swagger response model for paginated moderation reports (`GEN-10`). */
export class PaginatedReportsResponseDto implements Paginated<ReportResponseDto> {
  @ApiProperty({ type: [ReportResponseDto] })
  items!: ReportResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
