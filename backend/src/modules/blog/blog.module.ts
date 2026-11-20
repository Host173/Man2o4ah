import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsModule } from '../accounts/accounts.module.js';
import { ItinerariesModule } from '../itineraries/itineraries.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { StorageModule } from '../storage/storage.module.js';
import {
  CommentReportableContent,
  PostReportableContent,
} from './blog-reportable-content.js';
import { BlogController } from './blog.controller.js';
import { BlogService } from './blog.service.js';
import { PostImageCleanupJob } from './post-image-cleanup.job.js';
import { Comment, CommentSchema } from './schemas/comment.schema.js';
import { Like, LikeSchema } from './schemas/like.schema.js';
import {
  PostImageCleanup,
  PostImageCleanupSchema,
} from './schemas/post-image-cleanup.schema.js';
import { Post, PostSchema } from './schemas/post.schema.js';

@Module({
  imports: [
    AccountsModule,
    ItinerariesModule,
    ModerationModule,
    StorageModule,
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
      { name: PostImageCleanup.name, schema: PostImageCleanupSchema },
    ]),
  ],
  controllers: [BlogController],
  providers: [
    BlogService,
    PostImageCleanupJob,
    PostReportableContent,
    CommentReportableContent,
  ],
  exports: [BlogService],
})
export class BlogModule {}
