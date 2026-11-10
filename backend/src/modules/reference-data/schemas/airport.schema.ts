import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Reference data: `_id` is the CSV `iata_code`, e.g. 'CAI'. */
@Schema({ collection: 'airports', timestamps: false, versionKey: false })
export class Airport {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** → cities (by ID) */
  @Prop({ type: String, required: true })
  cityId!: string;

  /** → countries (by ID) */
  @Prop({ type: String, required: true })
  countryCode!: string;

  /** IANA zone, e.g. 'Africa/Cairo' */
  @Prop({ type: String, required: true })
  timeZone!: string;
}

export type AirportDocument = HydratedDocument<Airport>;
export const AirportSchema = SchemaFactory.createForClass(Airport);
AirportSchema.index({ cityId: 1 });
AirportSchema.index({ countryCode: 1 });
