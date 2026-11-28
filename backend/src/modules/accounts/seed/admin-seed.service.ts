import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import type { Model, Types } from 'mongoose';
import { BCRYPT_ROUNDS } from '../auth/auth.constants.js';
import { User, UserRole, UserStatus } from '../schemas/user.schema.js';
import type { AdminSeedInput } from './admin-seed-input.js';

/** The display name of the seeded admin (ACC-18). */
export const SEED_ADMIN_NAME = 'Admin';

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

export interface AdminSeedResult {
  /** `created` on the first run; `unchanged` when the admin already existed. */
  status: 'created' | 'unchanged';
  userId: string;
}

/** The fields the seed reads from an existing account. */
type FoundUser = { _id: Types.ObjectId; role: UserRole; status: UserStatus };

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
 * ACC-18: creates the admin account at setup; there is no admin
 * self-registration. Safe to re-run: keyed by email, it never changes an
 * existing admin (no password reset, so a password changed with ACC-08
 * stays) and never promotes an existing non-admin account.
 */
@Injectable()
export class AdminSeedService {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  /**
   * Creates an active admin with a bcrypt hash of the password and
   * `mustChangePassword: false`, unless an account with that email exists.
   * An existing admin → `unchanged`; any other role → throws, nothing
   * changes. Two parallel runs: the unique email index lets one create, the
   * other ends as `unchanged`.
   */
  async run(input: AdminSeedInput): Promise<AdminSeedResult> {
    const existing = await this.findByEmail(input.email);
    if (existing) return this.keepExisting(existing, input.email);

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    try {
      const user = await this.userModel.create({
        name: SEED_ADMIN_NAME,
        email: input.email,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
      });
      this.logger.log(`Admin account created for ${input.email}.`);
      return { status: 'created', userId: user._id.toString() };
    } catch (error) {
      // Another run created the account between our lookup and our insert.
      if (!isDuplicateEmail(error)) throw error;
      const winner = await this.findByEmail(input.email);
      if (!winner) throw error;
      return this.keepExisting(winner, input.email);
    }
  }

  private findByEmail(email: string): Promise<FoundUser | null> {
    return this.userModel
      .findOne({ email }, { role: 1, status: 1 })
      .lean<FoundUser | null>()
      .exec();
  }

  private keepExisting(user: FoundUser, email: string): AdminSeedResult {
    if (user.role !== UserRole.ADMIN) {
      throw new Error(
        `${email} is already registered with role "${user.role}". The admin seed never changes an existing account; set SEED_ADMIN_EMAIL to another address.`,
      );
    }
    this.logger.log(
      `Admin account for ${email} already exists (status ${user.status}); nothing changed.`,
    );
    return { status: 'unchanged', userId: user._id.toString() };
  }
}
