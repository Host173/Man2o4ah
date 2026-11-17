import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import type { Model, Types } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { LoginDto } from '../dto/login.dto.js';
import type { MeDto } from '../dto/me.response.dto.js';
import type { RegisterDto } from '../dto/register.dto.js';
import { Session } from '../schemas/session.schema.js';
import { UserRole, UserStatus } from '../schemas/user.schema.js';
import { User } from '../schemas/user.schema.js';
import {
  REFRESH_TOKEN_BYTES,
  REFRESH_TOKEN_COOKIE_MAX_AGE_MS,
  SESSION_IDLE_MS,
} from './auth.constants.js';
import type { AccessTokenPayload } from './auth.types.js';

/** bcrypt cost factor (auth.md §4). bcrypt adds a random salt to every hash. */
const BCRYPT_ROUNDS = 12;

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

function isDuplicateEmail(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, keyValue } = error as { code?: unknown; keyValue?: unknown };
  return (
    code === DUPLICATE_KEY &&
    typeof keyValue === 'object' &&
    keyValue !== null &&
    'email' in keyValue
  );
}

/** The same answer for "no such email" and "wrong password" (ACC-04). */
function invalidCredentials() {
  return new UnauthorizedException({
    code: ErrorCode.InvalidCredentials,
    message: 'Invalid email or password',
  });
}

/** The session is gone, idle-expired or revoked: log in again (ACC-06). */
function sessionExpired() {
  return new UnauthorizedException({
    code: ErrorCode.SessionExpired,
    message: 'Your session has expired. Please log in again.',
  });
}

/** SHA-256 of a refresh token, the only form a session stores (auth.md §3). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** What a successful login gives the controller: the account and the cookie values. */
export interface LoginResult {
  user: MeDto;
  accessToken: string;
  refreshToken: string;
}

/**
 * Registration, login and sessions (accounts only; not exported to other
 * modules, which use `AccountsService`).
 */
@Injectable()
export class AuthService {
  /**
   * A hash nobody's password matches, compared when the email is unknown so
   * that "no such email" takes as long as "wrong password" and response times
   * don't reveal which emails are registered. Made once, on first use.
   */
  private dummyHash?: Promise<string>;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
    private readonly jwt: JwtService,
  ) {}

  /**
   * ACC-04, ACC-19 (auth.md §4). Unknown email, wrong password or a
   * deactivated account → 401 INVALID_CREDENTIALS; right password on a
   * suspended account → 403 ACCOUNT_SUSPENDED. Otherwise creates a session
   * holding only the refresh token's hash and signs a 15-minute access token.
   * The tokens are for the cookies only, never a JSON body.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.userModel
      .findOne({ email: dto.email })
      .select('+passwordHash')
      .lean();

    // Compare even when there's no user, so timing reveals nothing.
    this.dummyHash ??= bcrypt.hash(
      randomBytes(16).toString('hex'),
      BCRYPT_ROUNDS,
    );
    const hash = user?.passwordHash ?? (await this.dummyHash);
    const passwordMatches = await bcrypt.compare(dto.password, hash);

    if (!user || user.status === UserStatus.DEACTIVATED || !passwordMatches) {
      throw invalidCredentials();
    }
    // Only after the right password: a stranger can't learn the account is suspended.
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: ErrorCode.AccountSuspended,
        message: 'Your account is suspended',
      });
    }

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const now = Date.now();
    const session = await this.sessionModel.create({
      userId: user._id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      lastActivityAt: new Date(now),
      expiresAt: new Date(now + SESSION_IDLE_MS),
    });

    const accessToken = await this.signAccessToken(user, session._id);

    return { user: toMe(user), accessToken, refreshToken };
  }

  /**
   * ACC-06, ACC-19 (auth.md §2, §3): `POST /api/auth/refresh`. Finds the live
   * session (`expiresAt > now`, created less than 7 days ago) holding this
   * refresh token's hash, slides its
   * activity to now + 30 minutes and returns a new access token. The refresh
   * token is not rotated, so parallel refreshes all succeed. A missing,
   * unknown, idle-expired or revoked token, or an account that is gone or no
   * longer active → 401 SESSION_EXPIRED.
   */
  async refresh(refreshToken: string | undefined): Promise<string> {
    if (!refreshToken) throw sessionExpired();
    const now = Date.now();

    const session = await this.sessionModel
      .findOne(
        {
          refreshTokenHash: hashRefreshToken(refreshToken),
          expiresAt: { $gt: new Date(now) },
          // The 7-day absolute limit is enforced here too, not only by the
          // cookie's maxAge, so a copied token can't be kept alive forever.
          createdAt: { $gt: new Date(now - REFRESH_TOKEN_COOKIE_MAX_AGE_MS) },
        },
        { userId: 1 },
      )
      .lean();
    if (!session) throw sessionExpired();

    const user = await this.userModel
      .findById(session.userId, { role: 1, status: 1, moderatorOf: 1 })
      .lean();
    // Suspension and deactivation delete sessions; this also covers a leftover one.
    if (!user || user.status !== UserStatus.ACTIVE) throw sessionExpired();

    // Refresh counts as activity. The expiresAt filter stops it from reviving
    // a session that expired or was revoked a moment ago.
    const slid = await this.sessionModel.updateOne(
      { _id: session._id, expiresAt: { $gt: new Date(now) } },
      {
        $set: {
          lastActivityAt: new Date(now),
          expiresAt: new Date(now + SESSION_IDLE_MS),
        },
      },
    );
    if (slid.matchedCount === 0) throw sessionExpired();

    return this.signAccessToken(user, session._id);
  }

  /**
   * ACC-06 (auth.md §3): `POST /api/auth/logout`. Deletes this device's
   * session, which revokes its refresh token; the user's other devices stay
   * logged in. Deleting a session that is already gone is not an error.
   */
  async logout(sid: string): Promise<void> {
    await this.sessionModel.deleteOne({ _id: sid });
  }

  /** Signs the 15-minute access token `{ sub, role, sid, providerId? }` (auth.md §2). */
  private signAccessToken(
    user: Pick<User, 'role' | 'moderatorOf'> & { _id: Types.ObjectId },
    sid: Types.ObjectId,
  ): Promise<string> {
    const providerId = user.moderatorOf?.providerId.toString();
    const payload: AccessTokenPayload = {
      sub: user._id.toString(),
      role: user.role,
      sid: sid.toString(),
      ...(providerId ? { providerId } : {}),
    };
    return this.jwt.signAsync(payload);
  }

  /**
   * ACC-19: the logged-in account for `GET /api/auth/me`. The guard has already
   * checked the session; an account deleted since then → 401 SESSION_EXPIRED.
   */
  async me(userId: string): Promise<MeDto> {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw sessionExpired();
    return toMe(user);
  }

  /**
   * ACC-01: creates a `user` account with only a salted bcrypt hash of the
   * password (GEN-13) and the consent time. Doesn't log the user in. A taken
   * email throws 409 EMAIL_TAKEN.
   */
  async register(dto: RegisterDto): Promise<MeDto> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      // No "does this email exist?" lookup first: two parallel requests could
      // both pass it. The unique index on email decides instead.
      const user = await this.userModel.create({
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: UserRole.USER,
        termsAcceptedAt: new Date(),
      });
      return toMe(user);
    } catch (error) {
      if (isDuplicateEmail(error)) {
        throw new ConflictException({
          code: ErrorCode.EmailTaken,
          message: 'This email is already registered',
          details: [
            { field: 'email', message: 'This email is already registered' },
          ],
        });
      }
      throw error;
    }
  }
}

/** The public view of an account; leaves out the hash and login counters. */
function toMe(user: User & { _id: Types.ObjectId }): MeDto {
  return {
    _id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    preferredCurrency: user.preferredCurrency,
    ...(user.moderatorOf
      ? {
          moderatorOf: {
            providerType: user.moderatorOf.providerType,
            providerId: user.moderatorOf.providerId.toString(),
          },
        }
      : {}),
    mustChangePassword: user.mustChangePassword,
  };
}
