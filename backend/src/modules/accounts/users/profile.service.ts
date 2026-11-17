import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types, UpdateQuery } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { ReferenceDataService } from '../../reference-data/reference-data.service.js';
import { toMe } from '../auth/auth.service.js';
import type { ProfileDto } from '../dto/me.response.dto.js';
import type { UpdateProfileDto } from '../dto/update-profile.dto.js';
import { User } from '../schemas/user.schema.js';

/** The guard checked the session; an account deleted since then can't be found. */
function sessionExpired() {
  return new UnauthorizedException({
    code: ErrorCode.SessionExpired,
    message: 'Your session has expired. Please log in again.',
  });
}

/** `MeDto` plus the phone, if the account has one. */
function toProfile(user: User & { _id: Types.ObjectId }): ProfileDto {
  const profile: ProfileDto = toMe(user);
  if (user.phone) profile.phone = user.phone;
  return profile;
}

/** ACC-09: the logged-in account's own profile (accounts only, not exported). */
@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /** ACC-09: the profile of the logged-in account. */
  async get(userId: string): Promise<ProfileDto> {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw sessionExpired();
    return toProfile(user);
  }

  /**
   * ACC-09: saves the fields sent, all or nothing. The DTO has already checked
   * their format; a currency that isn't in reference data → 400
   * UNSUPPORTED_CURRENCY, before anything is written. `phone: null` removes
   * the phone. One update, so no partial save is possible.
   */
  async update(userId: string, dto: UpdateProfileDto): Promise<ProfileDto> {
    if (dto.preferredCurrency !== undefined) {
      const currency = await this.referenceData.getCurrency(
        dto.preferredCurrency,
      );
      if (!currency) {
        const message = `${dto.preferredCurrency} is not a supported currency`;
        throw new BadRequestException({
          code: ErrorCode.UnsupportedCurrency,
          message,
          details: [{ field: 'preferredCurrency', message }],
        });
      }
    }

    const update: UpdateQuery<User> = {
      $set: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(typeof dto.phone === 'string' ? { phone: dto.phone } : {}),
        ...(dto.preferredCurrency !== undefined
          ? { preferredCurrency: dto.preferredCurrency }
          : {}),
      },
      ...(dto.phone === null ? { $unset: { phone: 1 } } : {}),
    };

    const user = await this.userModel
      .findByIdAndUpdate(userId, update, {
        returnDocument: 'after',
        runValidators: true,
      })
      .lean();
    if (!user) throw sessionExpired();
    return toProfile(user);
  }
}
