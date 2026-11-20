import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import { toPage } from '../../src/common/pagination/paginated.js';
import type { AuditService } from '../../src/modules/audit/audit.service.js';
import type {
  AuditLogQueryDto,
  AuditLogView,
} from '../../src/modules/audit/audit.types.js';
import type { PublicApi } from './public-api.js';

/** A working `AuditService` over entries you `add(...)`: filters, newest first (ties: id descending), paginated. */
export class FakeAuditService implements PublicApi<AuditService> {
  private readonly entries: AuditLogView[] = [];

  add(entry: AuditLogView): void {
    this.entries.push(entry);
  }

  list(query: AuditLogQueryDto): Promise<Paginated<AuditLogView>> {
    const { action, from, to, page, limit } = query;
    if (from && to && from > to) {
      return Promise.reject(
        new BadRequestException({
          code: ErrorCode.ValidationFailed,
          message: 'Validation failed',
          details: [{ field: 'from', message: 'from must be on or before to' }],
        }),
      );
    }
    const matching = this.entries
      .filter((entry) => !action || entry.action === action)
      .filter((entry) => !from || entry.createdAt >= from)
      .filter((entry) => !to || entry.createdAt <= to)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
    const items = matching.slice((page - 1) * limit, page * limit);
    return Promise.resolve(toPage(items, matching.length, page, limit));
  }
}
