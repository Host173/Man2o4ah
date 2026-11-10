import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { integerValidator, uniqueByValidator } from './validators.js';

@Schema({ _id: false })
export class CancellationTier {
  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  daysBefore!: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: 100,
    validate: integerValidator,
  })
  refundPercent!: number;
}

export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

/** `daysBefore` must be unique within a tier array. Use as `validate:` on the array prop. */
export const uniqueDaysBeforeValidator = uniqueByValidator('daysBefore');
