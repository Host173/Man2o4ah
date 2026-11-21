import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MAX_PRICE_MINOR } from '../../../common/money/money.js';
import { UpdateAirlineBaggagePolicyDto } from './update-airline-baggage-policy.dto.js';
import { UpdateAirlineCancellationPolicyDto } from './update-airline-cancellation-policy.dto.js';

function invalidProperties(dto: object): string[] {
  return validateSync(dto).map((error) => error.property);
}

describe('UpdateAirlineBaggagePolicyDto', () => {
  it.each([
    { extraBagPriceMinor: null, maxExtraBagsPerPassenger: 0 },
    { extraBagPriceMinor: null, maxExtraBagsPerPassenger: 1 },
    { extraBagPriceMinor: 1, maxExtraBagsPerPassenger: 0 },
    { extraBagPriceMinor: 1, maxExtraBagsPerPassenger: 1 },
    {
      extraBagPriceMinor: MAX_PRICE_MINOR,
      maxExtraBagsPerPassenger: Number.MAX_SAFE_INTEGER,
    },
  ])('accepts baggage policy field boundaries: %o', (input) => {
    const dto = plainToInstance(UpdateAirlineBaggagePolicyDto, input);
    expect(invalidProperties(dto)).toEqual([]);
  });

  it.each([
    [
      { extraBagPriceMinor: 0, maxExtraBagsPerPassenger: 0 },
      'extraBagPriceMinor',
    ],
    [
      { extraBagPriceMinor: -1, maxExtraBagsPerPassenger: 1 },
      'extraBagPriceMinor',
    ],
    [
      { extraBagPriceMinor: 1.5, maxExtraBagsPerPassenger: 1 },
      'extraBagPriceMinor',
    ],
    [
      {
        extraBagPriceMinor: Number.MAX_SAFE_INTEGER + 1,
        maxExtraBagsPerPassenger: 1,
      },
      'extraBagPriceMinor',
    ],
    [{ maxExtraBagsPerPassenger: 0 }, 'extraBagPriceMinor'],
    [{ extraBagPriceMinor: 1 }, 'maxExtraBagsPerPassenger'],
    [
      { extraBagPriceMinor: null, maxExtraBagsPerPassenger: -1 },
      'maxExtraBagsPerPassenger',
    ],
    [
      { extraBagPriceMinor: 1, maxExtraBagsPerPassenger: 1.5 },
      'maxExtraBagsPerPassenger',
    ],
    [
      {
        extraBagPriceMinor: 1,
        maxExtraBagsPerPassenger: Number.MAX_SAFE_INTEGER + 1,
      },
      'maxExtraBagsPerPassenger',
    ],
  ])('rejects invalid baggage policy input %o', (input, property) => {
    const dto = plainToInstance(UpdateAirlineBaggagePolicyDto, input);
    expect(invalidProperties(dto)).toContain(property);
  });
});

describe('UpdateAirlineCancellationPolicyDto', () => {
  it.each([
    { tiers: [] },
    { tiers: [{ daysBefore: 0, refundPercent: 0 }] },
    {
      tiers: [
        { daysBefore: 0, refundPercent: 0 },
        { daysBefore: Number.MAX_SAFE_INTEGER, refundPercent: 100 },
      ],
    },
  ])('accepts valid tier boundaries: %o', (input) => {
    const dto = plainToInstance(UpdateAirlineCancellationPolicyDto, input);
    expect(invalidProperties(dto)).toEqual([]);
  });

  it.each([
    [
      {
        tiers: [
          { daysBefore: 0, refundPercent: 0 },
          { daysBefore: 0, refundPercent: 100 },
        ],
      },
      'tiers',
    ],
    [{ tiers: [{ daysBefore: -1, refundPercent: 50 }] }, 'tiers'],
    [{ tiers: [{ daysBefore: 1.5, refundPercent: 50 }] }, 'tiers'],
    [
      {
        tiers: [{ daysBefore: Number.MAX_SAFE_INTEGER + 1, refundPercent: 50 }],
      },
      'tiers',
    ],
    [{ tiers: [{ daysBefore: 1, refundPercent: -1 }] }, 'tiers'],
    [{ tiers: [{ daysBefore: 1, refundPercent: 101 }] }, 'tiers'],
    [{ tiers: [{ daysBefore: 1, refundPercent: 50.5 }] }, 'tiers'],
    [{ tiers: [{ daysBefore: 1 }] }, 'tiers'],
    [{ tiers: [{ refundPercent: 50 }] }, 'tiers'],
    [{ tiers: null }, 'tiers'],
    [{}, 'tiers'],
  ])('rejects invalid cancellation policy input %o', (input, property) => {
    const dto = plainToInstance(UpdateAirlineCancellationPolicyDto, input);
    expect(invalidProperties(dto)).toContain(property);
  });
});
