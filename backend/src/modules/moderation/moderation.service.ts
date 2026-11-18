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
import { CreateReportDto } from './dto/create-report.dto.js';
import type { ReportView } from './moderation.types.js';
import { ReportableContentRegistry } from './ports/reportable-content.registry.js';
import { Report, ReportTargetType } from './schemas/report.schema.js';

type StoredReport = Report & { createdAt: Date; updatedAt: Date };
type ReportRecord = StoredReport & { _id: Types.ObjectId };

const MONGO_DUPLICATE_KEY_CODE = 11000;
const VALID_TARGET_TYPES = new Set<string>(Object.values(ReportTargetType));

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
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }
}
