import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
} from 'class-validator';
import type {
  ValidationArguments,
  ValidatorConstraintInterface,
} from 'class-validator';
import type { BaggagePolicyView } from '../flights.types.js';

interface BaggagePolicyInput {
  extraBagPriceMinor?: unknown;
  maxExtraBagsPerPassenger?: unknown;
}

@ValidatorConstraint({ name: 'validExtraBagPrice', async: false })
class ValidExtraBagPriceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const policy = args.object as BaggagePolicyInput;
    if (value === null) return policy.maxExtraBagsPerPassenger === 0;
    return (
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const policy = args.object as BaggagePolicyInput;
    return typeof policy.maxExtraBagsPerPassenger === 'number' &&
      policy.maxExtraBagsPerPassenger > 0
      ? 'extraBagPriceMinor must be a positive integer when extra bags are allowed'
      : 'extraBagPriceMinor must be a positive integer or null when extra bags are not allowed';
  }
}

export class UpdateAirlineBaggagePolicyDto implements BaggagePolicyView {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    example: 2500,
    description:
      'Price per extra bag in USD minor units; null is allowed when maximum is zero',
  })
  @Validate(ValidExtraBagPriceConstraint)
  extraBagPriceMinor!: number | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    example: 2,
  })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxExtraBagsPerPassenger!: number;
}
