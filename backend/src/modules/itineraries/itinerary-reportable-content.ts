import { Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ReportTargetType } from '../moderation/ports/reportable-content.port.js';
import type { ReportableContent } from '../moderation/ports/reportable-content.port.js';
import { ReportableContentRegistry } from '../moderation/ports/reportable-content.registry.js';
import { Itinerary } from './schemas/itinerary.schema.js';

const OBJECT_ID_HEX_RE = /^[0-9a-fA-F]{24}$/;

/**
 * CTR-07/GEN-09/GEN-10: exposes itineraries to the moderation module as
 * reportable content. Registered once in `onModuleInit`; the moderation module
 * never imports this one, so there is no cycle.
 */
@Injectable()
export class ItineraryReportableContent
  implements ReportableContent, OnModuleInit
{
  readonly targetType = ReportTargetType.ITINERARY;

  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
    private readonly registry: ReportableContentRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * GEN-09: whether the itinerary exists, hidden or not. Reporting is about the
   * stored item, and the moderation service turns `false` into a 404.
   */
  async exists(id: string): Promise<boolean> {
    if (typeof id !== 'string' || !OBJECT_ID_HEX_RE.test(id)) return false;
    const found = await this.itineraryModel.exists({
      _id: new Types.ObjectId(id),
    });
    return found !== null;
  }

  /** GEN-10: hides the itinerary from every shared list (idempotent). */
  async hide(id: string): Promise<void> {
    const result = await this.itineraryModel
      .updateOne({ _id: this.parseId(id) }, { $set: { isHidden: true } })
      .exec();
    if (!result.matchedCount) throw this.notFound();
  }

  /** GEN-10: permanently deletes the itinerary and every embedded item. */
  async delete(id: string): Promise<void> {
    const deleted = await this.itineraryModel
      .findOneAndDelete({ _id: this.parseId(id) })
      .lean()
      .exec();
    if (!deleted) throw this.notFound();
  }

  private parseId(id: string): Types.ObjectId {
    if (typeof id !== 'string' || !OBJECT_ID_HEX_RE.test(id)) {
      throw this.notFound();
    }
    return new Types.ObjectId(id);
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Itinerary not found',
    });
  }
}
