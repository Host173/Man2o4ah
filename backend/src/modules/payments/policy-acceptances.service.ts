import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { BookingType } from '../../common/database/booking-type.js';
import type {
  BookingPoliciesView,
  PolicyAcceptanceView,
} from './payments.types.js';
import { assertCanAcceptPolicies } from './policy-rules.js';
import { PayableBookingRegistry } from './ports/payable-booking.registry.js';
import { PolicyAcceptance } from './schemas/policy-acceptance.schema.js';

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === DUPLICATE_KEY
  );
}

/**
 * Shows a booking's policies and stores their acceptance (PAY-02). Internal to
 * payments. The accepted policy is the booking's own snapshot, so nothing is
 * copied: the acceptance only records who accepted and when.
 */
@Injectable()
export class PolicyAcceptancesService {
  constructor(
    @InjectModel(PolicyAcceptance.name)
    private readonly acceptances: Model<PolicyAcceptance>,
    private readonly registry: PayableBookingRegistry,
  ) {}

  /** The booking's policy snapshot and its acceptance, in any booking status. Never writes. */
  async getPolicies(
    userId: string,
    bookingType: BookingType,
    bookingId: string,
  ): Promise<BookingPoliciesView> {
    // 404 NOT_FOUND passes through: the booking doesn't exist or isn't the user's.
    const policies = await this.registry
      .get(bookingType)
      .getPolicies(bookingId, userId);
    // A wiring bug (500), not a client error.
    if (policies.bookingType !== bookingType) {
      throw new Error(
        `PayableBooking for "${bookingType}" returned "${policies.bookingType}" policies`,
      );
    }
    const acceptance = await this.acceptances
      .findOne({ bookingType, bookingId: new Types.ObjectId(bookingId) })
      .lean();
    return {
      ...policies,
      bookingId,
      accepted: acceptance !== null,
      acceptedAt: acceptance?.acceptedAt ?? null,
    };
  }

  /**
   * Stores the acceptance while the booking can still be paid. Idempotent: the
   * first timestamp wins, so a repeated or concurrent call returns the existing
   * acceptance unchanged.
   */
  async accept(
    userId: string,
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PolicyAcceptanceView> {
    // 404 NOT_FOUND passes through: this is the ownership check.
    const payable = await this.registry
      .get(bookingType)
      .getPayable(bookingId, userId);
    assertCanAcceptPolicies(payable, new Date());

    const filter = { bookingType, bookingId: new Types.ObjectId(bookingId) };
    let acceptance: { acceptedAt: Date } | null;
    try {
      // `$setOnInsert`, never `$set`: an existing acceptance keeps its time.
      acceptance = await this.acceptances
        .findOneAndUpdate(
          filter,
          {
            $setOnInsert: {
              userId: new Types.ObjectId(userId),
              acceptedAt: new Date(),
            },
          },
          { upsert: true, returnDocument: 'after' },
        )
        .lean();
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Two upserts raced on the unique index: the other one won.
      acceptance = await this.acceptances.findOne(filter).lean();
    }
    if (!acceptance) {
      throw new Error('The policy acceptance was not found after saving it');
    }
    return {
      bookingType,
      bookingId,
      accepted: true,
      acceptedAt: acceptance.acceptedAt,
    };
  }
}
