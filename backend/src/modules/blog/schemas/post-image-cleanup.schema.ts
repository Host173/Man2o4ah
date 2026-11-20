import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

/** BLG-10: retained until the deleted post's file has been removed. */
@Schema({ collection: 'post_image_cleanups', timestamps: true })
export class PostImageCleanup {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  postId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  key!: string;
}

export const PostImageCleanupSchema =
  SchemaFactory.createForClass(PostImageCleanup);
PostImageCleanupSchema.index({ key: 1 }, { unique: true });
PostImageCleanupSchema.index({ postId: 1, _id: 1 });
