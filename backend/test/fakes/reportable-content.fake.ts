import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type {
  ReportableContent,
  ReportTargetType,
} from '../../src/modules/moderation/ports/reportable-content.port.js';

export interface FakeReportableEntry {
  isHidden: boolean;
}

/**
 * In-memory `ReportableContent` implementation for unit and contract tests
 * (CTR-07, HTL-23, ITN-20, BLG-01, GEN-09, GEN-10).
 *
 * Seed content IDs in the constructor or with `add(id)` / `set(id)`.
 * - `exists(id)` returns `true` for present items (even if hidden) and `false`
 *   when missing or deleted.
 * - `hide(id)` marks the item hidden (`isHidden = true`), is idempotent on
 *   repeated calls, and throws 404 `NOT_FOUND` for unknown or deleted items.
 * - `delete(id)` removes the item and throws 404 `NOT_FOUND` for unknown or
 *   already-deleted items.
 */
export class FakeReportableContent implements ReportableContent {
  private readonly entries = new Map<string, FakeReportableEntry>();

  constructor(
    readonly targetType: ReportTargetType,
    initialIds: Iterable<string> = [],
  ) {
    for (const id of initialIds) {
      this.add(id);
    }
  }

  /** Seeds or overwrites a reportable content entry in memory. */
  add(id: string, options: { isHidden?: boolean } = {}): void {
    this.entries.set(id, { isHidden: options.isHidden ?? false });
  }

  /** Alias for `add(id, options)` matching `FakePayableBooking.set`. */
  set(id: string, options: { isHidden?: boolean } = {}): void {
    this.add(id, options);
  }

  /** Synchronous test helper: whether `id` is currently stored. */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Synchronous test helper: whether `id` is currently marked hidden. */
  isHidden(id: string): boolean {
    return this.entries.get(id)?.isHidden ?? false;
  }

  /** Resets all stored entries. */
  clear(): void {
    this.entries.clear();
  }

  // The port methods are async so a 404 rejects the promise, like real implementers.
  async exists(id: string): Promise<boolean> {
    return this.entries.has(id);
  }

  async hide(id: string): Promise<void> {
    const entry = this.find(id);
    entry.isHidden = true;
  }

  async delete(id: string): Promise<void> {
    this.find(id);
    this.entries.delete(id);
  }

  private find(id: string): FakeReportableEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: `${this.targetType} "${id}" not found`,
      });
    }
    return entry;
  }
}
