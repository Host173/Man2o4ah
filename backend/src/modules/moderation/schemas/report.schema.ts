import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/** GEN-09 */
export const ReportTargetType = {
  POST: 'post',
  COMMENT: 'comment',
  REVIEW: 'review',
  ITINERARY: 'itinerary',
} as const;
export type ReportTargetType =
  (typeof ReportTargetType)[keyof typeof ReportTargetType];

export const ReportStatus = {
  OPEN: 'open',
  DISMISSED: 'dismissed',
  CONTENT_HIDDEN: 'content_hidden',
  CONTENT_DELETED: 'content_deleted',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

/** One report per user per item (unique index). */
@Schema({ collection: 'reports', timestamps: true })
export class Report {
  /** → users */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  reporterId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(ReportTargetType),
  })
  targetType!: ReportTargetType;

  /** → the targetType collection; existence is checked through the content port. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 500,
  })
  reason!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(ReportStatus),
    default: ReportStatus.OPEN,
  })
  status!: ReportStatus;

  /** → users (the admin who resolved it) */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  resolvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  resolvedAt?: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ targetType: 1, targetId: 1 });
