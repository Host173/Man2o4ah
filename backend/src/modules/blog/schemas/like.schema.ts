import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/** One like per user per post (BLG-06): a duplicate key means already liked. */
@Schema({ collection: 'likes', timestamps: true })
export class Like {
  /** → posts */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  postId!: Types.ObjectId;

  /** → users */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;
}

export type LikeDocument = HydratedDocument<Like>;
export const LikeSchema = SchemaFactory.createForClass(Like);
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
LikeSchema.index({ userId: 1 });
