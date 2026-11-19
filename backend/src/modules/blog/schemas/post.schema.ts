import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Error as MongooseError,
  Schema as MongooseSchema,
  Types,
} from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import {
  ImageRef,
  ImageRefSchema,
} from '../../../common/database/image-ref.schema.js';
import {
  integerValidator,
  maxItemsValidator,
  uniqueValuesValidator,
} from '../../../common/database/validators.js';

export const PostStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
} as const;
export type PostStatus = (typeof PostStatus)[keyof typeof PostStatus];

@Schema({ collection: 'posts', timestamps: true })
export class Post {
  /** → users */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  authorId!: Types.ObjectId;

  /** BLG-13: reference only; itinerary access stays with ItinerariesService. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    set: (value: unknown) => {
      // Mongoose otherwise casts a singleton array through its toString().
      if (Array.isArray(value)) {
        throw new MongooseError.CastError('ObjectId', value, 'itineraryId');
      }
      return value;
    },
  })
  itineraryId?: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 150,
  })
  title!: string;

  @Prop({ type: String, required: true, minlength: 1, maxlength: 20000 })
  body!: string;

  /**
   * BLG-08: 0-5 tags, each trimmed, lowercased, 1-30 chars. Elements are
   * normalised when cast, so duplicates are checked after trim/lowercase.
   */
  @Prop({
    type: [
      {
        type: String,
        trim: true,
        lowercase: true,
        minlength: 1,
        maxlength: 30,
      },
    ],
    default: [],
    validate: [maxItemsValidator(5), uniqueValuesValidator],
  })
  tags!: string[];

  /** 0-5 images (GEN-08). */
  @Prop({
    type: [ImageRefSchema],
    default: [],
    validate: maxItemsValidator(5),
  })
  images!: ImageRef[];

  @Prop({ type: String, required: true, enum: Object.values(PostStatus) })
  status!: PostStatus;

  /** Set by the service the first time the post is published. */
  @Prop({ type: Date })
  publishedAt?: Date;

  /** `$inc` with likes. */
  @Prop({
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: integerValidator,
  })
  likeCount!: number;

  /** Counts visible comments only. */
  @Prop({
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: integerValidator,
  })
  commentCount!: number;

  /** Set by an admin (GEN-10). */
  @Prop({ type: Boolean, required: true, default: false })
  isHidden!: boolean;

  /** Set on user.deactivated / user.reactivated (ACC-12). */
  @Prop({ type: Boolean, required: true, default: false })
  authorDeactivated!: boolean;
}

export type PostDocument = HydratedDocument<Post>;
export const PostSchema = SchemaFactory.createForClass(Post);
PostSchema.index({
  status: 1,
  isHidden: 1,
  authorDeactivated: 1,
  publishedAt: -1,
});
PostSchema.index({ authorId: 1, updatedAt: -1 });
PostSchema.index({ tags: 1, status: 1 });
