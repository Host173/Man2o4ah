import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/** "Post must be published" is checked by the service. */
@Schema({ collection: 'comments', timestamps: true })
export class Comment {
  /** → posts */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  postId!: Types.ObjectId;

  /** → users */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  authorId!: Types.ObjectId;

  /** BLG-05 */
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 500,
  })
  body!: string;

  /** Set by an admin (GEN-10). */
  @Prop({ type: Boolean, required: true, default: false })
  isHidden!: boolean;
}

export type CommentDocument = HydratedDocument<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ postId: 1, createdAt: 1 });
CommentSchema.index({ authorId: 1 });
