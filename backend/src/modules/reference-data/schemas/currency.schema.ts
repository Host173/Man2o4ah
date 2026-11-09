import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { integerValidator } from '../../../common/database/validators.js';

/** Supported currencies. `_id` is the ISO 4217 code, e.g. 'USD'. */
@Schema({ collection: 'currencies', timestamps: false, versionKey: false })
export class Currency {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: 3,
    validate: integerValidator,
  })
  minorUnits!: number;
}

export type CurrencyDocument = HydratedDocument<Currency>;
export const CurrencySchema = SchemaFactory.createForClass(Currency);
