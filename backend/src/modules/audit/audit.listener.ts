import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Events } from '../../common/events/events.js';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import { AuditAction, AuditLog } from './schemas/audit-log.schema.js';

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const SECRET_KEY = /pass(word)?|token|secret|hash/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A shallow copy of `details` without secret-looking keys, or undefined if nothing is left (GEN-07). */
function sanitizeDetails(
  details: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(details)) return undefined;
  const kept = Object.fromEntries(
    Object.entries(details).filter(([key]) => !SECRET_KEY.test(key)),
  );
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Stores one append-only `audit_logs` document per `admin.action` event (GEN-07). */
@Injectable()
export class AuditListener {
  private readonly logger = new Logger(AuditListener.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly model: Model<AuditLog>,
  ) {}

  @OnEvent(Events.AdminAction)
  async onAdminAction(
    payload: PayloadOf<typeof Events.AdminAction>,
  ): Promise<void> {
    try {
      const invalid = this.invalidField(payload);
      if (invalid) {
        this.logger.warn(`Ignored an invalid admin.action event: ${invalid}`);
        return;
      }
      const details = sanitizeDetails(payload.details);
      await this.model.create({
        actorId: new Types.ObjectId(payload.actorId),
        action: payload.action,
        target: { type: payload.target.type, id: payload.target.id },
        ...(details ? { details } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to store an audit entry: ${message}`);
    }
  }

  /** The name of the first invalid field, or undefined when the event is valid. */
  private invalidField(
    payload: PayloadOf<typeof Events.AdminAction>,
  ): string | undefined {
    const event: Partial<PayloadOf<typeof Events.AdminAction>> | null = payload;
    if (typeof event?.actorId !== 'string' || !OBJECT_ID.test(event.actorId)) {
      return 'actorId';
    }
    if (!(Object.values(AuditAction) as unknown[]).includes(event.action)) {
      return 'action';
    }
    if (!isNonEmptyString(event.target?.type)) return 'target.type';
    if (!isNonEmptyString(event.target.id)) return 'target.id';
    return undefined;
  }
}
