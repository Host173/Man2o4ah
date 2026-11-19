import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDate, IsIn, IsOptional } from 'class-validator';
import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { AuditAction } from './schemas/audit-log.schema.js';

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_DESCRIPTION =
  '`YYYY-MM-DD` (that whole UTC day, inclusive) or an ISO date-time (inclusive)';

/** Turns a query value into a Date; `endOfDay` makes a calendar day end at 23:59:59.999Z (GEN-07). */
function toBound(value: unknown, endOfDay: boolean): unknown {
  if (typeof value !== 'string') return value;
  if (!CALENDAR_DAY.test(value)) return new Date(value);
  try {
    const start = toDateOnly(value);
    return endOfDay ? new Date(addDays(start, 1).getTime() - 1) : start;
  } catch {
    return new Date(NaN);
  }
}

/** The query of `GET /api/admin/audit-logs`: page, limit, action and an inclusive date range (GEN-07). */
export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Object.values(AuditAction) })
  @IsOptional()
  @IsIn(Object.values(AuditAction))
  action?: AuditAction;

  @ApiPropertyOptional({ type: String, description: DATE_DESCRIPTION })
  @IsOptional()
  @Transform(({ value }) => toBound(value, false))
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, description: DATE_DESCRIPTION })
  @IsOptional()
  @Transform(({ value }) => toBound(value, true))
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
