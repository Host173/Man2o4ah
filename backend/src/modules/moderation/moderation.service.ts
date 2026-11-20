import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { paginate } from '../../common/pagination/paginate.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { AuditAction } from '../audit/audit.types.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import { ListReportsQueryDto } from './dto/list-reports-query.dto.js';
import {
  ReportResolutionAction,
  ResolveReportDto,
} from './dto/resolve-report.dto.js';
import type { ReportView } from './moderation.types.js';
import { ReportableContentRegistry } from './ports/reportable-content.registry.js';
import {
  Report,
  ReportStatus,
  ReportTargetType,
} from './schemas/report.schema.js';

type StoredReport = Report & { createdAt: Date; updatedAt: Date };
type ReportRecord = StoredReport & { _id: Types.ObjectId };

const MONGO_DUPLICATE_KEY_CODE = 11000;
const VALID_TARGET_TYPES = new Set<string>(Object.values(ReportTargetType));
const VALID_REPORT_STATUSES = new Set<string>(Object.values(ReportStatus));
const VALID_RESOLUTION_ACTIONS = new Set<string>(
  Object.values(ReportResolutionAction),
);
const ACTION_TO_STATUS: Record<ReportResolutionAction, ReportStatus> = {
  [ReportResolutionAction.DISMISS]: ReportStatus.DISMISSED,
  [ReportResolutionAction.HIDE]: ReportStatus.CONTENT_HIDDEN,
  [ReportResolutionAction.DELETE]: ReportStatus.CONTENT_DELETED,
};

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { code?: unknown; cause?: unknown };
  if (record.code === MONGO_DUPLICATE_KEY_CODE) return true;
  return (
    typeof record.cause === 'object' &&
    record.cause !== null &&
    (record.cause as { code?: unknown }).code === MONGO_DUPLICATE_KEY_CODE
  );
}

/**
 * Content reporting and admin report resolution (`GEN-09`, `GEN-10`).
 */
@Injectable()
export class ModerationService {
  constructor(
    @InjectModel(Report.name)
    private readonly reportModel: Model<StoredReport>,
    private readonly registry: ReportableContentRegistry,
    private readonly events: AppEvents,
  ) {}

  /**
   * GEN-09: creates an open report against an existing reportable item,
   * relying on the `{ reporterId, targetType, targetId }` unique index to
   * enforce at most one report per user per item.
   */
  async createReport(
    dto: CreateReportDto,
    reporterId: string,
  ): Promise<ReportView> {
    const reporterObjectId = this.parseObjectId(reporterId, 'reporterId');
    if (!VALID_TARGET_TYPES.has(dto.targetType)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          {
            field: 'targetType',
            message: 'targetType must be a valid reportable content type',
          },
        ],
      });
    }
    const targetObjectId = this.parseObjectId(dto.targetId, 'targetId');
    const reason = this.normalizeReason(dto.reason);

    const provider = this.registry.get(dto.targetType);
    const exists = await provider.exists(targetObjectId.toHexString());
    if (!exists) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Reported content item not found',
      });
    }

    try {
      const created = await this.reportModel.create({
        reporterId: reporterObjectId,
        targetType: dto.targetType,
        targetId: targetObjectId,
        reason,
      });
      return this.toView(created.toObject());
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: ErrorCode.AlreadyReported,
          message: 'You have already reported this content item',
        });
      }
      throw error;
    }
  }

  /**
   * GEN-10: lists moderation reports paginated and sorted newest first,
   * filtered by `status` (defaults to `open`).
   */
  async listReports(
    query: ListReportsQueryDto = new ListReportsQueryDto(),
  ): Promise<Paginated<ReportView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const status = query.status ?? ReportStatus.OPEN;
    if (!VALID_REPORT_STATUSES.has(status)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          {
            field: 'status',
            message: 'status must be a valid report status',
          },
        ],
      });
    }

    const result = await paginate(
      this.reportModel,
      { status },
      { page, limit },
      { sort: { createdAt: -1, _id: -1 } },
    );

    return {
      ...result,
      items: result.items.map((report) => this.toView(report as ReportRecord)),
    };
  }

  /**
   * GEN-10: resolves an open report (`dismiss`, `hide`, or `delete`), closes
   * all open sibling reports targeting the same content item atomically to
   * prevent duplicate concurrent resolutions, executes content moderation if
   * needed (rolling back the claim on failure), and emits `Events.AdminAction`.
   */
  async resolveReport(
    reportId: string,
    dto: ResolveReportDto,
    adminId: string,
  ): Promise<ReportView> {
    const reportObjectId = this.parseObjectId(reportId, 'reportId');
    const adminObjectId = this.parseObjectId(adminId, 'adminId');
    if (!dto || !VALID_RESOLUTION_ACTIONS.has(dto.action)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          {
            field: 'action',
            message: 'action must be one of: dismiss, hide, delete',
          },
        ],
      });
    }

    const existing = await this.reportModel
      .findById(reportObjectId)
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Report not found',
      });
    }
    if (existing.status !== ReportStatus.OPEN) {
      throw new ConflictException({
        code: ErrorCode.InvalidStatusTransition,
        message: 'Report has already been resolved',
      });
    }

    const targetStatus = ACTION_TO_STATUS[dto.action];
    const resolvedAt = new Date();

    const { claimed, siblingIds, closedCount } =
      await this.claimOpenReportAndSiblings(
        reportObjectId,
        existing.targetType,
        existing.targetId,
        targetStatus,
        adminObjectId,
        resolvedAt,
      );

    const targetHexId = existing.targetId.toHexString();
    if (
      dto.action === ReportResolutionAction.HIDE ||
      dto.action === ReportResolutionAction.DELETE
    ) {
      const provider = this.registry.get(existing.targetType);
      try {
        if (dto.action === ReportResolutionAction.HIDE) {
          await provider.hide(targetHexId);
        } else {
          await provider.delete(targetHexId);
        }
      } catch (error) {
        await this.reportModel
          .updateMany(
            {
              _id: { $in: [reportObjectId, ...siblingIds] },
              status: targetStatus,
              resolvedAt,
            },
            {
              $set: { status: ReportStatus.OPEN },
              $unset: { resolvedBy: 1, resolvedAt: 1 },
            },
          )
          .exec();
        throw error;
      }
    }

    const adminHexId = adminObjectId.toHexString();
    this.events.emit(Events.AdminAction, {
      eventId: randomUUID(),
      actorId: adminHexId,
      action: AuditAction.REPORT_RESOLVED,
      target: { type: 'report', id: reportObjectId.toHexString() },
      details: {
        action: dto.action,
        status: targetStatus,
        targetType: existing.targetType,
        targetId: targetHexId,
        closedCount,
      },
    });

    if (dto.action === ReportResolutionAction.HIDE) {
      this.events.emit(Events.AdminAction, {
        eventId: randomUUID(),
        actorId: adminHexId,
        action: AuditAction.CONTENT_HIDDEN,
        target: { type: existing.targetType, id: targetHexId },
        details: { reportId: reportObjectId.toHexString() },
      });
    } else if (dto.action === ReportResolutionAction.DELETE) {
      this.events.emit(Events.AdminAction, {
        eventId: randomUUID(),
        actorId: adminHexId,
        action: AuditAction.CONTENT_DELETED,
        target: { type: existing.targetType, id: targetHexId },
        details: { reportId: reportObjectId.toHexString() },
      });
    }

    return this.toView(claimed);
  }

  /**
   * GEN-10: directly hides a reportable content item by type and ID, closes any
   * open reports targeting it with `content_hidden`, and emits an audit event.
   */
  async hideContent(
    targetType: ReportTargetType,
    targetId: string,
    adminId: string,
  ): Promise<void> {
    await this.moderateDirectContent(
      targetType,
      targetId,
      adminId,
      'hide',
      ReportStatus.CONTENT_HIDDEN,
      AuditAction.CONTENT_HIDDEN,
    );
  }

  /**
   * GEN-10: directly deletes a reportable content item by type and ID, closes
   * any open reports targeting it with `content_deleted`, and emits an audit event.
   */
  async deleteContent(
    targetType: ReportTargetType,
    targetId: string,
    adminId: string,
  ): Promise<void> {
    await this.moderateDirectContent(
      targetType,
      targetId,
      adminId,
      'delete',
      ReportStatus.CONTENT_DELETED,
      AuditAction.CONTENT_DELETED,
    );
  }

  private async moderateDirectContent(
    targetType: ReportTargetType,
    targetId: string,
    adminId: string,
    operation: 'hide' | 'delete',
    reportStatus: ReportStatus,
    auditAction: AuditAction,
  ): Promise<void> {
    if (!VALID_TARGET_TYPES.has(targetType)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          {
            field: 'type',
            message: 'type must be a valid reportable content type',
          },
        ],
      });
    }
    const targetObjectId = this.parseObjectId(targetId, 'id');
    const adminObjectId = this.parseObjectId(adminId, 'adminId');

    const provider = this.registry.get(targetType);
    const targetHexId = targetObjectId.toHexString();
    if (operation === 'hide') {
      await provider.hide(targetHexId);
    } else {
      await provider.delete(targetHexId);
    }

    const closedResult = await this.reportModel
      .updateMany(
        {
          targetType,
          targetId: targetObjectId,
          status: ReportStatus.OPEN,
        },
        {
          $set: {
            status: reportStatus,
            resolvedBy: adminObjectId,
            resolvedAt: new Date(),
          },
        },
      )
      .exec();

    this.events.emit(Events.AdminAction, {
      eventId: randomUUID(),
      actorId: adminObjectId.toHexString(),
      action: auditAction,
      target: { type: targetType, id: targetHexId },
      details: { closedReportCount: closedResult.modifiedCount },
    });
  }

  private async claimOpenReportAndSiblings(
    reportObjectId: Types.ObjectId,
    targetType: ReportTargetType,
    targetId: Types.ObjectId,
    targetStatus: ReportStatus,
    adminObjectId: Types.ObjectId,
    resolvedAt: Date,
  ): Promise<{
    claimed: ReportRecord;
    siblingIds: Types.ObjectId[];
    closedCount: number;
  }> {
    const session = await this.reportModel.db.startSession();
    try {
      let claimed: ReportRecord | null = null;
      let siblingIds: Types.ObjectId[] = [];
      let closedCount = 0;

      await session.withTransaction(async () => {
        const updated = await this.reportModel
          .findOneAndUpdate(
            { _id: reportObjectId, status: ReportStatus.OPEN },
            {
              $set: {
                status: targetStatus,
                resolvedBy: adminObjectId,
                resolvedAt,
              },
            },
            { session, returnDocument: 'after' },
          )
          .lean()
          .exec();
        if (!updated) {
          throw new ConflictException({
            code: ErrorCode.InvalidStatusTransition,
            message: 'Report has already been resolved',
          });
        }

        const siblingDocs = await this.reportModel
          .find(
            {
              targetType,
              targetId,
              status: ReportStatus.OPEN,
              _id: { $ne: reportObjectId },
            },
            { _id: 1 },
            { session },
          )
          .lean()
          .exec();
        siblingIds = siblingDocs.map((doc) => doc._id);

        let siblingsModified = 0;
        if (siblingIds.length > 0) {
          const siblingsResult = await this.reportModel
            .updateMany(
              { _id: { $in: siblingIds }, status: ReportStatus.OPEN },
              {
                $set: {
                  status: targetStatus,
                  resolvedBy: adminObjectId,
                  resolvedAt,
                },
              },
              { session },
            )
            .exec();
          siblingsModified = siblingsResult.modifiedCount;
        }

        claimed = updated as ReportRecord;
        closedCount = 1 + siblingsModified;
      });

      if (!claimed) {
        throw new ConflictException({
          code: ErrorCode.InvalidStatusTransition,
          message: 'Report has already been resolved',
        });
      }

      return { claimed, siblingIds, closedCount };
    } finally {
      await session.endSession();
    }
  }

  private parseObjectId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field, message: `${field} must be a valid ObjectId` }],
      });
    }
    return new Types.ObjectId(value);
  }

  private normalizeReason(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field: 'reason', message: 'reason must be a string' }],
      });
    }
    const trimmed = value.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [
          {
            field: 'reason',
            message: 'reason must be between 1 and 500 characters',
          },
        ],
      });
    }
    return trimmed;
  }

  private toView(report: ReportRecord): ReportView {
    return {
      _id: report._id.toHexString(),
      reporterId: report.reporterId.toHexString(),
      targetType: report.targetType,
      targetId: report.targetId.toHexString(),
      reason: report.reason,
      status: report.status,
      ...(report.resolvedBy !== undefined
        ? { resolvedBy: report.resolvedBy.toHexString() }
        : {}),
      ...(report.resolvedAt !== undefined
        ? { resolvedAt: report.resolvedAt }
        : {}),
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }
}
