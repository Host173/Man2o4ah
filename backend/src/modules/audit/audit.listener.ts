import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Events } from '../../common/events/events.js';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import { AuditAction, AuditLog } from './schemas/audit-log.schema.js';

const OBJECT_ID = /^[0-9a-f]{24}$/i;
/**
 * A secret-looking key: starts with password/passwd/secret or ends with
 * password/passwd/token/secret/hash/apiKey (`resetToken`, `passwordHash`).
 * Whole words only, so `passengers` and `passportNo` are kept.
 */
const SECRET_KEY =
  /^(password|passwd|secret)|(password|passwd|token|secret|hash|apikey)$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `value` without secret-looking keys, at every level and inside arrays (GEN-07). */
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, item]) => [key, stripSecrets(item)]),
  );
}

/** `details` without secrets, or undefined if it isn't a plain object or nothing is left (GEN-07). */
function sanitizeDetails(
  details: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(details)) return undefined;
  const kept = stripSecrets(details) as Record<string, unknown>;
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
