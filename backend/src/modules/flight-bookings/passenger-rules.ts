import type { ErrorDetail } from '../../common/errors/error-body.js';
import type { PassengerType } from './schemas/flight-booking.schema.js';

/** What the passenger rules need from one segment (its airline's and cabin's limits). */
export interface RuleSegment {
  maxExtraBagsPerPassenger: number;
  /** Per bag; also the limit for extra bags (FLT-08). */
  maxBagWeightKg: number;
}

/** What the passenger rules need from one passenger, as the user entered it. */
export interface RulePassenger {
  type: PassengerType;
  /** A UTC DateOnly. */
  dateOfBirth: Date;
  extraBagCount: number;
  /** Weight per extra bag; required when `extraBagCount > 0`. */
  extraBagWeightKg?: number;
}

/** Full years between two UTC DateOnly values: how many birthdays have passed. */
function ageOn(dateOfBirth: Date, date: Date): number {
  let age = date.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    date.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (date.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      date.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** FLT-12: adult 12+, child 2–11, infant under 2, by age on the travel date. */
export function passengerTypeOn(
  dateOfBirth: Date,
  travelDate: Date,
): PassengerType {
  const age = ageOn(dateOfBirth, travelDate);
  if (age >= 12) return 'adult';
  if (age >= 2) return 'child';
  return 'infant';
}

/**
 * Every passenger and baggage rule of FLT-12 and FLT-19, checked at once.
 * `travelDate` is the outbound departure's local date (a UTC DateOnly).
 * Returns one `{ field, message }` per broken rule, for 400 VALIDATION_FAILED
 * `details` (GEN-02); an empty list means the passengers are valid.
 * Extra bags must fit every segment, so the lowest limit across segments applies.
 */
export function checkPassengers(
  passengers: readonly RulePassenger[],
  segments: readonly RuleSegment[],
  travelDate: Date,
): ErrorDetail[] {
  const errors: ErrorDetail[] = [];

  const adults = passengers.filter((p) => p.type === 'adult').length;
  const infants = passengers.filter((p) => p.type === 'infant').length;
  if (adults === 0) {
    errors.push({
      field: 'passengers',
      message: 'At least one adult is required',
    });
  }
  if (infants > adults) {
    errors.push({
      field: 'passengers',
      message: 'There can be no more infants than adults',
    });
  }

  const maxBags = Math.min(...segments.map((s) => s.maxExtraBagsPerPassenger));
  const maxWeightKg = Math.min(...segments.map((s) => s.maxBagWeightKg));

  passengers.forEach((passenger, i) => {
    const at = `passengers[${i}]`;

    if (passenger.dateOfBirth > travelDate) {
      errors.push({
        field: `${at}.dateOfBirth`,
        message: 'Date of birth cannot be after the travel date',
      });
    } else {
      const actual = passengerTypeOn(passenger.dateOfBirth, travelDate);
      if (actual !== passenger.type) {
        errors.push({
          field: `${at}.type`,
          message: `This passenger travels as ${actual} (age on the travel date)`,
        });
      }
    }

    if (passenger.extraBagCount > maxBags) {
      errors.push({
        field: `${at}.extraBagCount`,
        message: `At most ${maxBags} extra bags per passenger on this trip`,
      });
    }
    if (passenger.extraBagCount > 0) {
      const weight = passenger.extraBagWeightKg;
      if (weight === undefined || weight <= 0) {
        errors.push({
          field: `${at}.extraBagWeightKg`,
          message: 'Enter the weight per extra bag',
        });
      } else if (weight > maxWeightKg) {
        errors.push({
          field: `${at}.extraBagWeightKg`,
          message: `Each extra bag can weigh at most ${maxWeightKg} kg on this trip`,
        });
      }
    }
  });

  return errors;
}
