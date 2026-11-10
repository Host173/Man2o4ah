import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Reference data: `_id` is the CSV `attraction_id`, e.g. 'att-1'. */
@Schema({ collection: 'attractions', timestamps: false, versionKey: false })
export class Attraction {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** → cities (by ID) */
  @Prop({ type: String, required: true })
  cityId!: string;
}

export type AttractionDocument = HydratedDocument<Attraction>;
export const AttractionSchema = SchemaFactory.createForClass(Attraction);
AttractionSchema.index({ cityId: 1 });
