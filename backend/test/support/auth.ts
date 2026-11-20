import { createHash, randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { getSessionMaxAgeMs } from '../../src/modules/accounts/auth/auth.constants.js';
import {
  Session,
  SessionSchema,
} from '../../src/modules/accounts/schemas/session.schema.js';
import {
  ProviderType,
  User,
  UserRole,
  UserSchema,
} from '../../src/modules/accounts/schemas/user.schema.js';
import type { UserStatus } from '../../src/modules/accounts/schemas/user.schema.js';
import { TEST_JWT_ACCESS_SECRET } from './test-config.js';

const SESSION_MINUTES = 30;
const MINUTE_MS = 60_000;

const PROVIDER_TYPE_BY_ROLE: Partial<Record<UserRole, ProviderType>> = {
  [UserRole.AIRLINE_MODERATOR]: ProviderType.AIRLINE,
  [UserRole.HOTEL_MODERATOR]: ProviderType.HOTEL,
};

export interface LoginAsOptions {
  /** Moderators: their airline or hotel. Default: a new ObjectId. */
  providerId?: string;
  /** Default false. */
  mustChangePassword?: boolean;
  /** Default 'active'. */
  status?: UserStatus;
  /** Default false. true sets `expiresAt` one minute in the past. */
  sessionExpired?: boolean;
}

export interface LoggedInUser {
  id: string;
  role: UserRole;
  providerId?: string;
  sid: string;
  /** `access_token=<jwt>`, for `.set('Cookie', u.cookie)`. */
  cookie: string;
}

/**
 * Creates a real user and session and signs the access token the way the
 * auth guard expects (auth.md §2, §3): `{ sub, role, sid, providerId? }`,
 * HS256, 15 minutes.
 */
export async function loginAs(
  connection: Connection,
  role: UserRole,
  options: LoginAsOptions = {},
): Promise<LoggedInUser> {
  const UserModel =
    connection.models[User.name] ?? connection.model(User.name, UserSchema);
  const SessionModel =
    connection.models[Session.name] ??
    connection.model(Session.name, SessionSchema);
  await Promise.all([UserModel.init(), SessionModel.init()]);

  const providerType = PROVIDER_TYPE_BY_ROLE[role];
  const providerId = providerType
    ? new Types.ObjectId(options.providerId)
    : undefined;

  const user = await UserModel.create({
    name: `Test ${role}`,
    email: `${role}.${new Types.ObjectId().toHexString()}@test.local`,
    passwordHash: 'not-a-real-hash',
    role,
    status: options.status ?? 'active',
    mustChangePassword: options.mustChangePassword ?? false,
    ...(providerType && providerId
      ? { moderatorOf: { providerType, providerId } }
      : {}),
  });

  const now = Date.now();
  const session = await SessionModel.create({
    userId: user._id,
    refreshTokenHash: createHash('sha256')
      .update(randomBytes(48))
      .digest('hex'),
    lastActivityAt: new Date(now),
    absoluteExpiresAt: new Date(now + getSessionMaxAgeMs(role)),
    expiresAt: new Date(
      options.sessionExpired
        ? now - MINUTE_MS
        : now + SESSION_MINUTES * MINUTE_MS,
    ),
  });

  const id = user._id.toString();
  const sid = session._id.toString();
  const providerIdString = providerId?.toString();
  const token = await new JwtService({
    secret: TEST_JWT_ACCESS_SECRET,
  }).signAsync(
    {
      sub: id,
      role,
      sid,
      ...(providerIdString ? { providerId: providerIdString } : {}),
    },
    { algorithm: 'HS256', expiresIn: '15m' },
  );

  return {
    id,
    role,
    ...(providerIdString ? { providerId: providerIdString } : {}),
    sid,
    cookie: `access_token=${token}`,
  };
}
