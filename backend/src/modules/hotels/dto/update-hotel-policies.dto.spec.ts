import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { validationExceptionFactory } from '../../../common/errors/validation-exception.factory.js';
import { UpdateHotelPoliciesDto } from './update-hotel-policies.dto.js';

const policies = {
  checkInTime: '14:00',
  checkOutTime: '12:00',
  cancellationPolicy: {
    tiers: [
      { daysBefore: 7, refundPercent: 100 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  },
};

describe('hotel policy DTO (HTL-09, HTL-10)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });

  it('accepts time boundaries, unsorted unique thresholds, and an empty policy', async () => {
    for (const tiers of [
      [],
      [
        { daysBefore: 0, refundPercent: 0 },
        { daysBefore: 7, refundPercent: 100 },
      ],
    ]) {
      const input = {
        checkInTime: '23:59',
        checkOutTime: '00:00',
        cancellationPolicy: { tiers },
      };
      expect(
        await pipe.transform(input, {
          type: 'body',
          metatype: UpdateHotelPoliciesDto,
        }),
      ).toEqual(input);
    }
  });

  it.each(['checkInTime', 'checkOutTime'])(
    'rejects malformed or missing %s without coercion',
    async (field) => {
      for (const value of [
        '24:00',
        '12:60',
        '9:00',
        '14:00:00',
        ' 14:00 ',
        '14:00\n',
        '',
        1400,
        null,
        undefined,
      ]) {
        const errors = await validate(
          plainToInstance(UpdateHotelPoliciesDto, {
            ...policies,
            [field]: value,
          }),
        );
        expect(errors.map((error) => error.property)).toContain(field);
      }
    },
  );

  it('rejects duplicate thresholds and invalid nested tiers through the production pipe', async () => {
    for (const tiers of [
      [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
      ],
      [{ daysBefore: -1, refundPercent: 50 }],
      [{ daysBefore: 1.5, refundPercent: 50 }],
      [{ daysBefore: '7', refundPercent: 50 }],
      [{ daysBefore: 7, refundPercent: -1 }],
      [{ daysBefore: 7, refundPercent: 101 }],
      [{ daysBefore: 7, refundPercent: 50.5 }],
      [{ daysBefore: 7, refundPercent: '50' }],
      [{ daysBefore: 7 }],
      [{ refundPercent: 50 }],
      [null],
      ['invalid'],
      [[{ daysBefore: 7, refundPercent: 50 }]],
      [{ daysBefore: 7, refundPercent: 50, providerId: 'spoofed' }],
      null,
      {},
      undefined,
    ]) {
      await expect(
        pipe.transform(
          { ...policies, cancellationPolicy: { tiers } },
          { type: 'body', metatype: UpdateHotelPoliciesDto },
        ),
      ).rejects.toMatchObject({
        response: {
          code: ErrorCode.ValidationFailed,
          details: expect.arrayContaining([
            expect.objectContaining({
              field: expect.stringContaining('cancellationPolicy'),
            }),
          ]),
        },
      });
    }
  });

  it('requires an object policy and rejects protected fields at every level', async () => {
    for (const input of [
      { ...policies, cancellationPolicy: undefined },
      { ...policies, cancellationPolicy: null },
      { ...policies, cancellationPolicy: [] },
      { ...policies, cancellationPolicy: 'invalid' },
      { ...policies, cancellationPolicy: { tiers: [], isActive: false } },
      { ...policies, providerId: 'spoofed' },
      { ...policies, name: 'Not editable here' },
      { ...policies, isActive: false },
    ]) {
      await expect(
        pipe.transform(input, {
          type: 'body',
          metatype: UpdateHotelPoliciesDto,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.ValidationFailed },
      });
    }
  });
});
