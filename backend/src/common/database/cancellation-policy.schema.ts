import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  CancellationTier,
  CancellationTierSchema,
  uniqueDaysBeforeValidator,
} from './cancellation-tier.schema.js';

/** Cancellation policy wrapper of airlines (FLT-09) and hotels (HTL-10). */
@Schema({ _id: false })
export class CancellationPolicy {
  @Prop({ type: [CancellationTierSchema], validate: uniqueDaysBeforeValidator })
  tiers!: CancellationTier[];
}

export const CancellationPolicySchema =
  SchemaFactory.createForClass(CancellationPolicy);
