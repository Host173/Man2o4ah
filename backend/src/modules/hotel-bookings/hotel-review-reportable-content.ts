import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import {
  ReportTargetType,
  type ReportableContent,
} from '../moderation/ports/reportable-content.port.js';
import { ReportableContentRegistry } from '../moderation/ports/reportable-content.registry.js';
import { HotelReviewsService } from './hotel-reviews.service.js';

@Injectable()
export class HotelReviewReportableContent
  implements ReportableContent, OnModuleInit
{
  readonly targetType = ReportTargetType.REVIEW;

  constructor(
    private readonly registry: ReportableContentRegistry,
    private readonly reviews: HotelReviewsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  exists(id: string): Promise<boolean> {
    return this.reviews.reviewExists(id);
  }

  hide(id: string): Promise<void> {
    return this.reviews.hideByAdmin(id);
  }

  delete(id: string): Promise<void> {
    return this.reviews.deleteByAdmin(id);
  }
}
