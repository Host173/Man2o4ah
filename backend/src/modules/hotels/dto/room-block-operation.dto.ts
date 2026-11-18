import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsMongoId,
  Matches,
  ValidateIf,
} from 'class-validator';

export class RoomBlockOperationDto {
  @ApiProperty({ enum: ['BLOCK', 'UNBLOCK'] })
  @IsIn(['BLOCK', 'UNBLOCK'])
  op!: 'BLOCK' | 'UNBLOCK';

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-12-10',
    description: 'Required only for BLOCK; first blocked night, inclusive',
  })
  @ValidateIf(
    (input: RoomBlockOperationDto) =>
      input.op === 'BLOCK' || input.fromDate !== undefined,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  fromDate?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-12-12',
    description:
      'Required only for BLOCK; last blocked night, inclusive. Maximum 365 nights including both endpoints.',
  })
  @ValidateIf(
    (input: RoomBlockOperationDto) =>
      input.op === 'BLOCK' || input.toDate !== undefined,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  toDate?: string;

  @ApiPropertyOptional({
    description: 'Required only for UNBLOCK; removes the entire named block',
  })
  @ValidateIf(
    (input: RoomBlockOperationDto) =>
      input.op === 'UNBLOCK' || input.blockId !== undefined,
  )
  @IsMongoId()
  blockId?: string;
}

export class RoomBlockResponseDto {
  @ApiProperty({
    description: 'ID of the created or removed block',
  })
  blockId!: string;
}
