import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model, QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { keywordRegex } from '../../common/text/escape-regex.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { StorageService } from '../storage/storage.service.js';
import type { CreateAirlineDto } from './dto/create-airline.dto.js';
import type { UpdateAirlineBaggagePolicyDto } from './dto/update-airline-baggage-policy.dto.js';
import type { UpdateAirlineCancellationPolicyDto } from './dto/update-airline-cancellation-policy.dto.js';
import type { UpdateAirlineDto } from './dto/update-airline.dto.js';
import type {
  AirlineListItem,
  AirlineListQuery,
  AirlineListResult,
  AirlineView,
  CancellationTierView,
} from './flights.types.js';
import { Airline } from './schemas/airline.schema.js';

type AirlineRecord = Airline & {
  _id: Types.ObjectId;
  logo?: { _id: Types.ObjectId; key: string };
};

/** Airline profile workflows (FLT-01); deactivation is also called by admin (ACC-15). */
@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreateAirlineDto): Promise<AirlineView> {
    const airline = await this.airlineModel.create({
      name: dto.name.trim(),
      code: dto.code.trim().toUpperCase(),
    });
    return this.toView(airline.toObject() as AirlineRecord);
  }

  async getAirline(airlineId: string): Promise<AirlineView | null> {
    if (!Types.ObjectId.isValid(airlineId)) return null;
    const airline = await this.airlineModel.findById(airlineId).lean().exec();
    return airline ? this.toView(airline as AirlineRecord) : null;
  }

  /** Offset-based airline list for admin provider listing (BE-01). */
  async listAirlines(query: AirlineListQuery): Promise<AirlineListResult> {
    const filter: QueryFilter<Airline> = {};
    if (query.status === 'active') filter.isActive = true;
    else if (query.status === 'inactive') filter.isActive = false;

    const trimmed = query.q?.trim();
    if (trimmed) {
      const pattern = keywordRegex(trimmed);
      filter.$or = [{ name: pattern }, { code: pattern }];
    }

    if (query.limit <= 0) {
      const total = await this.airlineModel.countDocuments(filter).exec();
      return { items: [], total };
    }

    const [docs, total] = await Promise.all([
      this.airlineModel
        .find(filter, { name: 1, code: 1, isActive: 1 })
        .sort({ name: 1, _id: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean<
          (Pick<Airline, 'name' | 'code' | 'isActive'> & {
            _id: Types.ObjectId;
          })[]
        >()
        .exec(),
      this.airlineModel.countDocuments(filter).exec(),
    ]);

    const items: AirlineListItem[] = docs.map((doc) => ({
      id: doc._id.toString(),
      name: doc.name,
      code: doc.code,
      isActive: doc.isActive,
    }));
    return { items, total };
  }

  async update(
    airlineId: string,
    dto: UpdateAirlineDto,
    user: AuthUser,
  ): Promise<AirlineView> {
    await this.findOwned(airlineId, user.providerId);
    const updates = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.code !== undefined
        ? { code: dto.code.trim().toUpperCase() }
        : {}),
    };
    const airline = await this.airlineModel
      .findByIdAndUpdate(
        airlineId,
        { $set: updates },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!airline) throw this.notFound();
    return this.toView(airline as AirlineRecord);
  }

  async updateBaggagePolicy(
    airlineId: string,
    policy: UpdateAirlineBaggagePolicyDto,
    user: AuthUser,
  ): Promise<AirlineView> {
    await this.findOwned(airlineId, user.providerId);
    if (
      policy.maxExtraBagsPerPassenger > 0 &&
      policy.extraBagPriceMinor === null
    ) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'A price is required when extra bags are allowed',
        details: [
          {
            field: 'extraBagPriceMinor',
            message: 'must be a positive integer when extra bags are allowed',
          },
        ],
      });
    }
    const airline = await this.airlineModel
      .findByIdAndUpdate(
        airlineId,
        { $set: { baggagePolicy: policy } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!airline) throw this.notFound();
    return this.toView(airline as AirlineRecord);
  }

  async updateCancellationPolicy(
    airlineId: string,
    policy: UpdateAirlineCancellationPolicyDto,
    user: AuthUser,
  ): Promise<AirlineView> {
    await this.findOwned(airlineId, user.providerId);
    const airline = await this.airlineModel
      .findByIdAndUpdate(
        airlineId,
        { $set: { cancellationPolicy: { tiers: policy.tiers } } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!airline) throw this.notFound();
    return this.toView(airline as AirlineRecord);
  }

  async updateLogo(
    airlineId: string,
    file: UploadedImage | undefined,
    user: AuthUser,
  ): Promise<AirlineView> {
    await this.findOwned(airlineId, user.providerId);
    if (!file) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'A logo file is required',
        details: [{ field: 'file', message: 'is required' }],
      });
    }

    const stored = await this.storage.save(file);
    let previous: AirlineRecord | null;
    try {
      previous = (await this.airlineModel
        .findOneAndUpdate(
          { _id: new Types.ObjectId(airlineId) },
          { $set: { logo: { _id: stored._id, key: stored.key } } },
          { returnDocument: 'before', runValidators: true },
        )
        .lean()
        .exec()) as AirlineRecord | null;
    } catch (error) {
      await this.storage.delete(stored.key);
      throw error;
    }
    if (!previous) {
      await this.storage.delete(stored.key);
      throw this.notFound();
    }

    if (previous.logo) await this.storage.delete(previous.logo.key);
    previous.logo = { _id: stored._id, key: stored.key };
    return this.toView(previous);
  }

  async setAirlineActive(
    airlineId: string,
    isActive: boolean,
  ): Promise<AirlineView> {
    if (!Types.ObjectId.isValid(airlineId)) throw this.notFound();
    const airline = await this.airlineModel
      .findByIdAndUpdate(
        airlineId,
        { $set: { isActive } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!airline) throw this.notFound();
    return this.toView(airline as AirlineRecord);
  }

  private async findOwned(
    airlineId: string,
    providerId: string | undefined,
  ): Promise<AirlineRecord> {
    if (!Types.ObjectId.isValid(airlineId)) throw this.notFound();
    const airline = await this.airlineModel.findById(airlineId).lean().exec();
    if (!airline || !providerId || airline._id.toString() !== providerId) {
      throw this.notFound();
    }
    return airline as AirlineRecord;
  }

  private toView(airline: AirlineRecord): AirlineView {
    const cancellationTiers: CancellationTierView[] =
      airline.cancellationPolicy.tiers.map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      }));
    return {
      id: airline._id.toString(),
      name: airline.name,
      code: airline.code,
      isActive: airline.isActive,
      ...(airline.logo
        ? {
            logo: {
              id: airline.logo._id.toString(),
              url: this.storage.urlOf(airline.logo.key),
            },
          }
        : {}),
      baggagePolicy: {
        extraBagPriceMinor: airline.baggagePolicy.extraBagPriceMinor,
        maxExtraBagsPerPassenger:
          airline.baggagePolicy.maxExtraBagsPerPassenger,
      },
      cancellationTiers,
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Airline not found',
    });
  }
}
