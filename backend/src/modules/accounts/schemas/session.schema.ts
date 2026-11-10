import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/** One document per logged-in device (ACC-06, ACC-19). */
@Schema({ collection: 'sessions', timestamps: true })
export class Session {
  /** → users */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** SHA-256 of the refresh token; the token itself is never stored. */
  @Prop({ type: String, required: true })
  refreshTokenHash!: string;

  @Prop({ type: Date, required: true })
  lastActivityAt!: Date;

  /** lastActivityAt + 30 min (set by the service). TTL-deleted once passed. */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ userId: 1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
