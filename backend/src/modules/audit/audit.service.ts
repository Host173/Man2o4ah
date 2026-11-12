import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Paginated } from '../../common/pagination/paginated.js';
import type { AuditLogQueryDto, AuditLogView } from './audit.types.js';

@Injectable()
export class AuditService {
  /**
   * Newest first, filtered by action and an inclusive date range (GEN-07). Entries are written by the
   * audit module's own `admin.action` listener; no other module writes them. Implemented in GEN-07.
   */
  list(query: AuditLogQueryDto): Promise<Paginated<AuditLogView>> {
    void query;
    throw new NotImplementedException('list: implemented in GEN-07');
  }
}
