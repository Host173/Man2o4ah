import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import type { Connection, Model, Types } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { ChangePasswordDto } from '../dto/change-password.dto.js';
import type { LoginDto } from '../dto/login.dto.js';
import type { MeDto } from '../dto/me.response.dto.js';
import type { RegisterDto } from '../dto/register.dto.js';
import { Session } from '../schemas/session.schema.js';
import { UserRole, UserStatus } from '../schemas/user.schema.js';
import { User } from '../schemas/user.schema.js';
import {
  LOCKOUT_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  REFRESH_TOKEN_BYTES,
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

/** Whole minutes left in a lockout, rounded up so it never says 0 (ACC-05). */
export function lockoutMinutesLeft(lockedUntil: Date, now: number): number {
  return Math.ceil((lockedUntil.getTime() - now) / 60_000);
}

/** 401 ACCOUNT_LOCKED with the minutes left in the message (ACC-05). */
function accountLocked(lockedUntil: Date, now: number) {
  const minutes = lockoutMinutesLeft(lockedUntil, now);
  return new UnauthorizedException({
    code: ErrorCode.AccountLocked,
    message: `Too many failed login attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
  });
}

/**
 * A wrong current password on change-password (ACC-08): a 400 on the form
 * field, not a 401, because the caller is still logged in and the frontend
 * treats 401 as "log in again".
 */
function wrongCurrentPassword() {
  const message = 'Current password is incorrect';
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message,
    details: [{ field: 'currentPassword', message }],
  });
}

/**
 * A forced change (ACC-07a) that keeps the temporary password: the account
 * must set a *new* password, so this is a 400 on the `newPassword` field.
 */
function sameAsTemporaryPassword() {
  const message = 'New password must be different from the temporary password';
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message,
    details: [{ field: 'newPassword', message }],
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
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * ACC-04, ACC-05, ACC-19 (auth.md §4), in this order: unknown email or a
   * deactivated account → 401 INVALID_CREDENTIALS; a lock still running →
   * 401 ACCOUNT_LOCKED (even with the right password); a wrong password →
   * counted, and the 5th in a row locks for 15 minutes (ACCOUNT_LOCKED),
   * otherwise INVALID_CREDENTIALS; right password on a suspended account →
   * 403 ACCOUNT_SUSPENDED. Otherwise resets the counter, creates a session
   * holding only the refresh token's hash and signs a 15-minute access token.
   * The tokens are for the cookies only, never a JSON body.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const found = await this.userModel
      .findOne({ email: dto.email })
      .select('+passwordHash')
      .lean();
    // A deactivated account is treated exactly like an unknown email (ACC-12).
    const user = found?.status === UserStatus.DEACTIVATED ? null : found;

    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw accountLocked(user.lockedUntil, Date.now());
    }

    // Compare even when there's no user, so timing reveals nothing.
    this.dummyHash ??= bcrypt.hash(
      randomBytes(16).toString('hex'),
      BCRYPT_ROUNDS,
    );
    const hash = user?.passwordHash ?? (await this.dummyHash);
    const passwordMatches = await bcrypt.compare(dto.password, hash);

    if (!user) {
      throw invalidCredentials();
    }
    if (!passwordMatches) {
      await this.countFailedLogin(user._id);
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
    const dbSession = await this.connection.startSession();
    let sid: string;
    try {
      // Serialize session creation with password changes on the verified hash.
      sid = await dbSession.withTransaction(async () => {
        const result = await this.userModel.updateOne(
          { _id: user._id, passwordHash: hash },
          { $set: { failedLoginAttempts: 0, lockedUntil: null } },
          { session: dbSession },
        );
        if (result.matchedCount === 0) throw invalidCredentials();

        const now = Date.now();
        const [session] = await this.sessionModel.create(
          [
            {
              userId: user._id,
              refreshTokenHash: hashRefreshToken(refreshToken),
              lastActivityAt: new Date(now),
              expiresAt: new Date(now + SESSION_IDLE_MS),
            },
          ],
          { session: dbSession },
        );
        return session._id.toString();
      });
    } finally {
      await dbSession.endSession();
    }

    const providerId = user.moderatorOf?.providerId.toString();
    const payload: AccessTokenPayload = {
      sub: user._id.toString(),
      role: user.role,
      sid,
      ...(providerId ? { providerId } : {}),
    };
    const accessToken = await this.jwt.signAsync(payload);

    return { user: toMe(user), accessToken, refreshToken };
  }

  /**
   * ACC-05: counts one wrong password and, on the 5th in a row, locks the
   * account for 15 minutes and resets the counter; then throws
   * 401 ACCOUNT_LOCKED. Returns normally below the limit (the caller throws
   * INVALID_CREDENTIALS).
   *
   * Every step is a single atomic update, never read-then-write, so parallel
   * wrong passwords can't slip past the limit:
   * - `$inc` only matches while the account isn't locked, so an attempt that
   *   finishes after another one locked the account isn't counted towards
   *   the next round;
   * - only the attempt(s) that see a count of 5 or more lock the account.
   */
  private async countFailedLogin(userId: Types.ObjectId): Promise<void> {
    const now = Date.now();
    const notLocked = {
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date(now) } }],
    };

    const counted = await this.userModel
      .findOneAndUpdate(
        { _id: userId, ...notLocked },
        { $inc: { failedLoginAttempts: 1 } },
        { returnDocument: 'after', projection: { failedLoginAttempts: 1 } },
      )
      .lean();

    if (!counted) {
      // Another attempt locked the account while this one was checking the password.
      throw accountLocked(new Date(now + LOCKOUT_MS), now);
    }
    if (counted.failedLoginAttempts < MAX_FAILED_LOGIN_ATTEMPTS) return;

    const lockedUntil = new Date(now + LOCKOUT_MS);
    await this.userModel.updateOne(
      {
        _id: userId,
        failedLoginAttempts: { $gte: MAX_FAILED_LOGIN_ATTEMPTS },
      },
      { $set: { lockedUntil, failedLoginAttempts: 0 } },
    );
    throw accountLocked(lockedUntil, now);
  }

  /**
   * ACC-19: the logged-in account for `GET /api/auth/me`. The guard has already
   * checked the session; an account deleted since then → 401 SESSION_EXPIRED.
   */
  async me(userId: string): Promise<MeDto> {
    const user = await this.userModel.findById(userId).lean();
    if (!user) {
      throw new UnauthorizedException({
        code: ErrorCode.SessionExpired,
        message: 'Your session has expired. Please log in again.',
      });
    }
    return toMe(user);
  }

  /**
   * ACC-08, ACC-07a (auth.md §4): checks the current password, stores a new
   * salted bcrypt hash, clears `mustChangePassword` and deletes all of the
   * user's sessions (data-model.md §3.2). The caller must log in again.
   * A wrong current password → 400 VALIDATION_FAILED on `currentPassword`.
   * During a forced change (`mustChangePassword`), a new password that still
   * matches the temporary one → 400 VALIDATION_FAILED on `newPassword`; a
   * normal change may keep the same password (not decided otherwise).
   * The DTO has already applied the password rule to the new password.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('+passwordHash')
      .lean();
    if (!user) {
      throw new UnauthorizedException({
        code: ErrorCode.SessionExpired,
        message: 'Your session has expired. Please log in again.',
      });
    }
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw wrongCurrentPassword();
    }
    // Compared with the stored hash, not the typed text, so a new password
    // that bcrypt can't tell apart from the temporary one is caught too.
    if (
      user.mustChangePassword &&
      (await bcrypt.compare(dto.newPassword, user.passwordHash))
    ) {
      throw sameAsTemporaryPassword();
    }

    // Hashed before the transaction: it's slow and needn't be redone on a retry.
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    // One transaction: the new password and the logout of all sessions
    // must happen together, so a failure can't leave old sessions alive with
    // the password already changed (data-model.md §1.9).
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // Conditional on the hash just checked: if a parallel change won,
        // this one's current password is no longer right (no read-then-write).
        const result = await this.userModel.updateOne(
          { _id: user._id, passwordHash: user.passwordHash },
          { $set: { passwordHash, mustChangePassword: false } },
          { session },
        );
        if (result.modifiedCount === 0) {
          throw wrongCurrentPassword();
        }
        await this.sessionModel.deleteMany({ userId: user._id }, { session });
      });
    } finally {
      await session.endSession();
    }
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
