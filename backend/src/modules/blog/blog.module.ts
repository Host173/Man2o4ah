import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsModule } from '../accounts/accounts.module.js';
import { ItinerariesModule } from '../itineraries/itineraries.module.js';
import { BlogController } from './blog.controller.js';
import { BlogService } from './blog.service.js';
import { Comment, CommentSchema } from './schemas/comment.schema.js';
import { Like, LikeSchema } from './schemas/like.schema.js';
import { Post, PostSchema } from './schemas/post.schema.js';

@Module({
  imports: [
    AccountsModule,
    ItinerariesModule,
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
    ]),
  ],
  controllers: [BlogController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
