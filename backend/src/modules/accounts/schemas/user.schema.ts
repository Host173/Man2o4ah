import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { integerValidator } from '../../../common/database/validators.js';
import { getPlatformCurrency } from '../../../common/money/platform-currency.js';

export const UserRole = {
  USER: 'user',
  ADMIN: 'admin',
  AIRLINE_MODERATOR: 'airline_moderator',
  HOTEL_MODERATOR: 'hotel_moderator',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEACTIVATED: 'deactivated',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ProviderType = {
  AIRLINE: 'airline',
  HOTEL: 'hotel',
} as const;
export type ProviderType = (typeof ProviderType)[keyof typeof ProviderType];

/** The provider type each moderator role must moderate (ACC-13). */
const PROVIDER_TYPE_BY_ROLE: Partial<Record<UserRole, ProviderType>> = {
  [UserRole.AIRLINE_MODERATOR]: ProviderType.AIRLINE,
  [UserRole.HOTEL_MODERATOR]: ProviderType.HOTEL,
};

/** Simple strict email shape: local@domain.tld (checked after lowercasing). */
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Lenient phone format: optional '+', a digit, then 5-19 digits/spaces/().- (also checked by UpdateProfileDto). */
export const PHONE = /^\+?[0-9][0-9\s().-]{5,19}$/;

@Schema({ _id: false })
export class ModeratorOf {
  @Prop({ type: String, required: true, enum: Object.values(ProviderType) })
  providerType!: ProviderType;

  /** → airlines or hotels, by providerType */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  providerId!: Types.ObjectId;
}

export const ModeratorOfSchema = SchemaFactory.createForClass(ModeratorOf);

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 100,
  })
  name!: string;

  /** Unique through UserSchema.index({ email: 1 }, { unique: true }). */
  @Prop({
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: EMAIL,
  })
  email!: string;

  @Prop({ type: String, required: true, select: false })
  passwordHash!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(UserRole),
    default: UserRole.USER,
  })
  role!: UserRole;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @Prop({ type: String, match: PHONE })
  phone?: string;

  /** → currencies (by ID) */
  @Prop({ type: String, required: true, default: () => getPlatformCurrency() })
  preferredCurrency!: string;

  /** Required for moderator roles, absent otherwise; type matches the role. */
  @Prop({
    type: ModeratorOfSchema,
    required(this: User) {
      return PROVIDER_TYPE_BY_ROLE[this.role] !== undefined;
    },
    validate: {
      validator(this: User, value: ModeratorOf) {
        return value.providerType === PROVIDER_TYPE_BY_ROLE[this.role];
      },
      message:
        'moderatorOf is only allowed for moderator roles, and providerType must match the role.',
    },
  })
  moderatorOf?: ModeratorOf;

  @Prop({ type: Boolean, required: true, default: false })
  mustChangePassword!: boolean;

  /** Required on guest self-registration (ACC-01); enforced by the service. */
  @Prop({ type: Date })
  termsAcceptedAt?: Date;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    default: 0,
    validate: integerValidator,
  })
  failedLoginAttempts!: number;

  @Prop({ type: Date })
  lockedUntil?: Date | null;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1, status: 1, createdAt: -1 });
UserSchema.index({ 'moderatorOf.providerId': 1 });
