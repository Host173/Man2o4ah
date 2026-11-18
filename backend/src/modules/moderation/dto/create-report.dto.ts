import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ReportTargetType } from '../schemas/report.schema.js';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Request payload for reporting reportable content (`GEN-09`). */
export class CreateReportDto {
  @ApiProperty({
    enum: Object.values(ReportTargetType),
    example: ReportTargetType.POST,
    description: 'Type of content being reported',
  })
  @IsIn(Object.values(ReportTargetType))
  targetType!: ReportTargetType;

  @ApiProperty({
    example: '6736f0b2c5a1b2c3d4e5f610',
    description: 'Mongo ObjectId of the reported content item',
  })
  @IsMongoId()
  targetId!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 500,
    example: 'Contains spam links unrelated to travel.',
    description: 'Reason for reporting the item (trimmed, 1–500 characters)',
  })
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
