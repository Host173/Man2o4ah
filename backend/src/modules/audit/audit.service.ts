import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { paginate } from '../../common/pagination/paginate.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import type { AuditLogQueryDto, AuditLogView } from './audit.types.js';
import { AuditLog } from './schemas/audit-log.schema.js';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name) private readonly model: Model<AuditLog>,
  ) {}

  /**
   * Newest first, filtered by action and an inclusive date range (GEN-07). Entries are written by the
   * audit module's own `admin.action` listener; no other module writes them.
   */
  async list(query: AuditLogQueryDto): Promise<Paginated<AuditLogView>> {
    const { action, from, to } = query;
    if (from && to && from > to) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field: 'from', message: 'from must be on or before to' }],
      });
    }
    const filter: QueryFilter<AuditLog> = {};
    if (action) filter.action = action;
    if (from || to) {
      filter.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }
    const page = await paginate(this.model, filter, query, {
      sort: { createdAt: -1, _id: -1 },
    });
    return {
      ...page,
      items: page.items.map((doc) => ({
        id: String(doc._id),
        actorId: doc.actorId.toString(),
        action: doc.action,
        target: { type: doc.target.type, id: doc.target.id },
        ...(doc.details ? { details: doc.details } : {}),
        createdAt: (doc as unknown as { createdAt: Date }).createdAt,
      })),
    };
  }
}
