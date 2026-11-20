import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import type { Model, Types } from 'mongoose';
import { StorageService } from '../storage/storage.service.js';
import { PostImageCleanup } from './schemas/post-image-cleanup.schema.js';

const EVERY_30_SECONDS = 30_000;
const BATCH_SIZE = 100;

/** BLG-10: retries committed post-image deletions, including after a restart. */
@Injectable()
export class PostImageCleanupJob {
  private readonly logger = new Logger(PostImageCleanupJob.name);

  constructor(
    @InjectModel(PostImageCleanup.name)
    private readonly cleanupModel: Model<PostImageCleanup>,
    private readonly storage: StorageService,
  ) {}

  @Interval(EVERY_30_SECONDS)
  async run(): Promise<void> {
    await this.deletePending();
  }

  /** Called after commit for one post, or by the job for all pending files. */
  async deletePending(postId?: string): Promise<void> {
    let after: Types.ObjectId | undefined;
    for (;;) {
      const batch = await this.cleanupModel
        .find({
          ...(postId ? { postId } : {}),
          ...(after ? { _id: { $gt: after } } : {}),
        })
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .lean()
        .exec();
      const last = batch.at(-1);
      if (!last) return;

      await Promise.all(
        batch.map(async (item) => {
          try {
            // Idempotent storage deletion also makes overlapping workers safe.
            await this.storage.delete(item.key);
            await this.cleanupModel
              .deleteOne({ _id: item._id, key: item.key })
              .exec();
          } catch (error) {
            this.logger.error(
              `Image cleanup pending for post ${item.postId.toHexString()}, key ${item.key}`,
              error instanceof Error ? error.stack : undefined,
            );
          }
        }),
      );

      // Advance past failures as well, so they cannot starve later files.
      after = last._id;
      if (batch.length < BATCH_SIZE) return;
    }
  }
}
