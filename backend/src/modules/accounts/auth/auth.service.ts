import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { MeDto } from '../dto/me.response.dto.js';
import type { RegisterDto } from '../dto/register.dto.js';
import { UserRole } from '../schemas/user.schema.js';
import type { UserDocument } from '../schemas/user.schema.js';
import { User } from '../schemas/user.schema.js';

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

/**
 * Registration and sessions (accounts only; not exported to other modules,
 * which use `AccountsService`).
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

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
function toMe(user: UserDocument): MeDto {
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
