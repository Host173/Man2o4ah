import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import {
  ReportTargetType,
  type ReportableContent,
} from '../moderation/ports/reportable-content.port.js';
import { ReportableContentRegistry } from '../moderation/ports/reportable-content.registry.js';
import { BlogService } from './blog.service.js';

/**
 * Registers `post` reportable-content operations (`exists`, `hide`, `delete`)
 * with `ReportableContentRegistry` on module init (`CTR-07`, `GEN-09`, `GEN-10`).
 */
@Injectable()
export class PostReportableContent implements ReportableContent, OnModuleInit {
  readonly targetType = ReportTargetType.POST;

  constructor(
    private readonly registry: ReportableContentRegistry,
    private readonly blogService: BlogService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  exists(id: string): Promise<boolean> {
    return this.blogService.postExists(id);
  }

  hide(id: string): Promise<void> {
    return this.blogService.hidePost(id);
  }

  delete(id: string): Promise<void> {
    return this.blogService.deletePostByAdmin(id);
  }
}

/**
 * Registers `comment` reportable-content operations (`exists`, `hide`, `delete`)
 * with `ReportableContentRegistry` on module init (`CTR-07`, `GEN-09`, `GEN-10`).
 */
@Injectable()
export class CommentReportableContent
  implements ReportableContent, OnModuleInit
{
  readonly targetType = ReportTargetType.COMMENT;

  constructor(
    private readonly registry: ReportableContentRegistry,
    private readonly blogService: BlogService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  exists(id: string): Promise<boolean> {
    return this.blogService.commentExists(id);
  }

  hide(id: string): Promise<void> {
    return this.blogService.hideComment(id);
  }

  delete(id: string): Promise<void> {
    return this.blogService.deleteCommentByAdmin(id);
  }
}
