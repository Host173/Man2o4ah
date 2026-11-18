import type {
  ReportStatus,
  ReportTargetType,
} from './schemas/report.schema.js';

/** Plain view of a moderation report returned by `ModerationService` and HTTP endpoints (`GEN-09`). */
export interface ReportView {
  _id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: ReportStatus;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
