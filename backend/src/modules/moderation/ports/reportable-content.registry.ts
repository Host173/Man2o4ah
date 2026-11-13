import { Injectable } from '@nestjs/common';
import { ReportTargetType } from '../schemas/report.schema.js';
import type { ReportableContent } from './reportable-content.port.js';

/**
 * Where content-owning modules plug in as `ReportableContent` (CTR-07, GEN-09,
 * GEN-10). Content modules (`blog`, `hotel-bookings`, `itineraries`) import
 * `ModerationModule`, so `moderation` must never import them: each provider
 * registers itself in `onModuleInit`.
 *
 * ```ts
 * @Injectable()
 * export class PostReportableContent implements ReportableContent, OnModuleInit {
 *   readonly targetType = ReportTargetType.POST;
 *   constructor(private readonly registry: ReportableContentRegistry) {}
 *   onModuleInit() { this.registry.register(this); }
 *   // exists, hide, delete …
 * }
 * ```
 */
@Injectable()
export class ReportableContentRegistry {
  private static readonly validTargetTypes = new Set<string>(
    Object.values(ReportTargetType),
  );

  private readonly providers = new Map<ReportTargetType, ReportableContent>();

  /** Registers the implementer of its `targetType`; a second one for the same type is a wiring bug. */
  register(content: ReportableContent): void {
    if (!ReportableContentRegistry.validTargetTypes.has(content.targetType)) {
      throw new Error(
        `Unknown ReportableContent targetType "${String(content.targetType)}".`,
      );
    }
    if (this.providers.has(content.targetType)) {
      throw new Error(
        `A ReportableContent for "${content.targetType}" is already registered.`,
      );
    }
    this.providers.set(content.targetType, content);
  }

  /** The implementer of `type`; none registered is a wiring bug (500). */
  get(type: ReportTargetType): ReportableContent {
    const content = this.providers.get(type);
    if (!content) {
      throw new Error(`No ReportableContent is registered for "${type}".`);
    }
    return content;
  }
}

