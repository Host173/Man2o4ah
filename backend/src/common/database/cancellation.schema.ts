import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { integerValidator } from './validators.js';

export const CancelledBy = {
  USER: 'user',
  PROVIDER: 'provider',
} as const;
export type CancelledBy = (typeof CancelledBy)[keyof typeof CancelledBy];

@Schema({ _id: false })
export class Cancellation {
  @Prop({ type: Date, required: true })
  cancelledAt!: Date;

  @Prop({ type: String, required: true, enum: Object.values(CancelledBy) })
  cancelledBy!: CancelledBy;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: 100,
    validate: integerValidator,
  })
  refundPercent!: number;

  @Prop({ type: Number, required: true, min: 0, validate: integerValidator })
  refundAmountMinor!: number;
}

export const CancellationSchema = SchemaFactory.createForClass(Cancellation);
