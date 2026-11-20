import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { AuditLogView } from '../../audit/audit.types.js';
import { AuditAction } from '../../audit/audit.types.js';

export class AuditLogTargetDto {
  @ApiProperty({ example: 'user' })
  type!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e50001' })
  id!: string;
}

/** An audit entry as `GET /api/admin/audit-logs` returns it; `id` becomes `_id` (GEN-07). */
export class AuditLogResponseDto {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e50001' })
  _id!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e50002' })
  actorId!: string;

  @ApiProperty({ enum: Object.values(AuditAction) })
  action!: AuditAction;

  @ApiProperty({ type: AuditLogTargetDto })
  target!: AuditLogTargetDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  details?: Record<string, unknown>;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-19T12:00:00.000Z',
  })
  createdAt!: Date;

  static fromView(view: AuditLogView): AuditLogResponseDto {
    return {
      _id: view.id,
      actorId: view.actorId,
      action: view.action,
      target: { type: view.target.type, id: view.target.id },
      ...(view.details ? { details: view.details } : {}),
      createdAt: view.createdAt,
    };
  }
}

/** Swagger response model for the paginated audit log (GEN-07). */
export class PaginatedAuditLogsResponseDto implements Paginated<AuditLogResponseDto> {
  @ApiProperty({ type: [AuditLogResponseDto] })
  items!: AuditLogResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
