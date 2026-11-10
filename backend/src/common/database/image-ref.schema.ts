import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Reference to an image file on disk (data-model 1.6). Keeps its own _id. */
@Schema()
export class ImageRef {
  @Prop({ type: String, required: true })
  key!: string;
}

export const ImageRefSchema = SchemaFactory.createForClass(ImageRef);
