import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export const AuditAction = {
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCOUNT_REACTIVATED: 'account_reactivated',
  MODERATOR_CREATED: 'moderator_created',
  PASSWORD_RESET: 'password_reset',
  PROVIDER_DEACTIVATED: 'provider_deactivated',
  PROVIDER_REACTIVATED: 'provider_reactivated',
  REPORT_RESOLVED: 'report_resolved',
  CONTENT_HIDDEN: 'content_hidden',
  CONTENT_DELETED: 'content_deleted',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** What the action applied to, e.g. `{ type: 'user', id }`. */
@Schema({ _id: false })
export class AuditTarget {
  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: String, required: true })
  id!: string;
}

export const AuditTargetSchema = SchemaFactory.createForClass(AuditTarget);

/** Append-only (GEN-07): no update or delete anywhere in the code. */
@Schema({
  collection: 'audit_logs',
  timestamps: { createdAt: true, updatedAt: false },
})
export class AuditLog {
  /** → users (the admin) */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  actorId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(AuditAction) })
  action!: AuditAction;

  @Prop({ type: AuditTargetSchema, required: true })
  target!: AuditTarget;

  /**
   * Free-form, small, no secrets (never passwords). Deliberately Mixed: the
   * data model gives it no shape, so nothing inside it is cast or validated.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  details?: Record<string, unknown>;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ 'target.type': 1, 'target.id': 1 });
