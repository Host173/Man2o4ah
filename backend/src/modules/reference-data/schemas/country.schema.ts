import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Reference data: `_id` is the dataset's own ID (CSV `code`, e.g. 'EG'). */
@Schema({ collection: 'countries', timestamps: false, versionKey: false })
export class Country {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** → currencies (by ID) */
  @Prop({ type: String, required: true })
  currency!: string;
}

export type CountryDocument = HydratedDocument<Country>;
export const CountrySchema = SchemaFactory.createForClass(Country);
