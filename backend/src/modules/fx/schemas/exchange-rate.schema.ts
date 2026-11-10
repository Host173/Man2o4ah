import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { positiveNumberValidator } from '../../../common/database/validators.js';
import { dateOnlyValidator } from '../../../common/dates/date-only.js';

/** Daily FX rates (ITN-18), one document per UTC fetch date. */
@Schema({ collection: 'exchange_rates', timestamps: true })
export class ExchangeRate {
  /** UTC date of the fetch; unique through the index. */
  @Prop({ type: Date, required: true, validate: dateOnlyValidator })
  rateDate!: Date;

  /** → currencies (by ID); the currency the rates are relative to. */
  @Prop({ type: String, required: true })
  base!: string;

  /** One entry per supported currency, each > 0, including base = 1. */
  @Prop({
    type: Map,
    of: { type: Number, validate: positiveNumberValidator },
    required: true,
    validate: {
      validator(this: ExchangeRate, rates: Map<string, number>) {
        return rates.get(this.base) === 1;
      },
      message: 'rates must contain the base currency with a rate of 1.',
    },
  })
  rates!: Map<string, number>;

  @Prop({ type: Date, required: true })
  fetchedAt!: Date;

  /** e.g. 'fxratesapi' */
  @Prop({ type: String, required: true })
  source!: string;
}

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;
export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
ExchangeRateSchema.index({ rateDate: -1 }, { unique: true });
