import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { AuditAction } from './schemas/audit-log.schema.js';

/** The query of `GET /api/admin/audit-logs`: page, limit, action and an inclusive date range (GEN-07). */
export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Object.values(AuditAction) })
  @IsOptional()
  @IsIn(Object.values(AuditAction))
  action?: AuditAction;

  /** Inclusive. */
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Inclusive. */
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

/** An audit entry as the admin endpoint returns it (GEN-07). */
export interface AuditLogView {
  id: string;
  actorId: string;
  action: AuditAction;
  target: { type: string; id: string };
  details?: Record<string, unknown>;
  createdAt: Date;
}
