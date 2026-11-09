import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Reference data: `_id` is the CSV `city_id`, e.g. 'new_york'. */
@Schema({ collection: 'cities', timestamps: false, versionKey: false })
export class City {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** → countries (by ID) */
  @Prop({ type: String, required: true })
  countryCode!: string;
}

export type CityDocument = HydratedDocument<City>;
export const CitySchema = SchemaFactory.createForClass(City);
CitySchema.index({ countryCode: 1 });
